'use strict';
/*
 * F280 — release mockups cover the actual Contents contract.
 *
 * The first generator named eight screenshots by hand. A new menu section
 * could therefore ship with no mockup, and a blank data panel still passed
 * because the navbar/footer made the whole page nonempty. These guards derive
 * the expected shots from the same contract the app menu uses.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'assets', 'mockups.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
const sectionsSource = fs.readFileSync(path.join(ROOT, 'www', 'sections.html'), 'utf8');
const alertSource = fs.readFileSync(
  path.join(ROOT, 'assets', 'mockup-alertfeed.js'), 'utf8');
const workflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'ios-build.yml'), 'utf8');
const postWorkflowPath = path.join(
  ROOT, '.github', 'workflows', 'post-release.yml');
const postWorkflow = fs.existsSync(postWorkflowPath)
  ? fs.readFileSync(postWorkflowPath, 'utf8')
  : '';
const pkg = require(path.join(ROOT, 'package.json'));
const mockups = require(path.join(ROOT, 'assets', 'mockups.js'));
const waSeen = require(path.join(
  ROOT, 'tests', 'fixtures', 'wa-seen-2026-stub.json'));

async function wizardEndpoint(profile, read = fs.readFileSync) {
  const deadline = Date.now() + 15000;
  let polls = 0, lastEndpoint = 'not read';
  while (Date.now() < deadline) {
    try {
      polls++;
      const [port, route] = read(path.join(profile, 'DevToolsActivePort'), 'utf8')
        .trim().split(/\r?\n/);
      lastEndpoint = 'incomplete or invalid';
      if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535
        && /^\/devtools\/browser\/[^\s/]+$/.test(route)) {
        return 'ws://127.0.0.1:' + port + route;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error;
      lastEndpoint = error.code;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('wizard Chrome startup timed out after 15000ms; polls='
    + polls + '; last endpoint=' + lastEndpoint);
}

function cleanupWizardProfile(profile, run = spawnSync, deadline = Date.now() + 10000) {
  const escaped = profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = '(?:^|\\s)"?--user-data-dir="?' + escaped + '"?(?=\\s|$)';
  let failure;
  try {
    if (process.platform === 'win32') {
      const script = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $pattern='"
        + pattern.replace(/'/g, "''") + "'; "
        + "$cleanupWatch=[Diagnostics.Stopwatch]::StartNew(); "
        + "[Console]::Error.WriteLine('WIZARD_CLEANUP started'); "
        + "function Test-LivePid([int]$ownedPid) { "
        + "try { return -not (Get-Process -Id $ownedPid -ErrorAction Stop).HasExited } "
        + "catch { if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') { return $false }; throw } }; "
        + "for ($i=0; $i -lt 10; $i++) { "
        + "[Console]::Error.WriteLine('WIZARD_CLEANUP inventory_start_ms='+$cleanupWatch.ElapsedMilliseconds); "
        + "$owned = @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
        + "Where-Object { $_.CommandLine -match $pattern } | "
        + "Where-Object { Test-LivePid $_.ProcessId }); "
        + "[Console]::Error.WriteLine('WIZARD_CLEANUP inventory_end_ms='+$cleanupWatch.ElapsedMilliseconds+' live='+$owned.Count); "
        + "if (-not $owned.Count) { exit 0 }; "
        + "$owned | ForEach-Object { $ownedPid=$_.ProcessId; "
        + "[Console]::Error.WriteLine('WIZARD_CLEANUP stop_start_ms='+$cleanupWatch.ElapsedMilliseconds+' pid='+$ownedPid); "
        + "try { Stop-Process -Id $ownedPid -Force "
        + "-ErrorAction Stop } catch { if (Test-LivePid $ownedPid) { throw } }; "
        + "[Console]::Error.WriteLine('WIZARD_CLEANUP stop_end_ms='+$cleanupWatch.ElapsedMilliseconds+' pid='+$ownedPid) }; "
        + "Start-Sleep -Milliseconds 100 }; exit 1";
      const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: 'pipe', timeout: 10000 });
      if (result.error || result.status !== 0) throw new Error('wizard exact-profile process cleanup unverified: '
        + (result.error ? result.error.message + '; ' : '') + String(result.stderr || result.status));
    } else {
      const owned = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('wizard process cleanup deadline exceeded');
        const result = run('ps', ['-axo', 'pid=,args='], { encoding: 'utf8', timeout: remaining });
        if (result.error || result.status !== 0) throw new Error('wizard process inventory unverified: '
          + (result.error ? result.error.message + '; ' : '') + String(result.stderr || result.status));
        return result.stdout.split('\n').filter(line => new RegExp(pattern).test(line))
          .map(line => Number(line.trim().split(/\s+/)[0]));
      };
      const pause = new Int32Array(new SharedArrayBuffer(4));
      for (let attempt = 0; attempt < 10; attempt++) {
        const pids = owned();
        if (!pids.length) break;
        pids.forEach(pid => {
          try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        });
        Atomics.wait(pause, 0, 0, Math.min(100, Math.max(0, deadline - Date.now())));
      }
      const survivors = owned();
      if (survivors.length) throw new Error('wizard exact-profile processes survived: ' + survivors.join(', '));
    }
  } catch (error) { failure = error; }
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) { failure = failure || error; }
  if (failure || fs.existsSync(profile)) {
    throw new Error('F1218 wizard cleanup could not be verified: ' + profile
      + (failure ? ': ' + failure.message : ''), { cause: failure });
  }
}

async function cleanupWizardBrowser(profile, browser, run = spawnSync) {
  const deadline = Date.now() + 10000;
  const remaining = () => {
    const budget = deadline - Date.now();
    if (budget <= 0) throw new Error('wizard browser cleanup deadline exceeded');
    return budget;
  };
  try {
    const command = await mockups.withTimeout(browser.send('Browser.getBrowserCommandLine'),
      remaining(), 'wizard cleanup profile identity');
    if (!Array.isArray(command.arguments)
      || !command.arguments.includes('--user-data-dir=' + profile)) {
      throw new Error('wizard cleanup browser does not own the exact profile');
    }
    await mockups.withTimeout(browser.send('Browser.close'),
      Math.min(5000, remaining()), 'wizard graceful cleanup').catch(() => {});
  } finally {
    cleanupWizardProfile(profile, (command, args, options) =>
      run(command, args, {...options, timeout:Math.min(options.timeout, remaining())}), deadline);
  }
}

test('F1177 F1180 real Chrome keeps edits usable and cannot inherit a pointer or held key across seen-list completion',
  { timeout: 120000 }, async () => {
    assert.ok(mockups.CHROME, 'real Chrome is required');
    const seen = { yearList: waSeen.birds.filter(row => row.seen) };
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-input-'));
    await new Promise(resolve => mockups.server.listen(0, '127.0.0.1', resolve));
    const chrome = spawn(mockups.CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      '--user-data-dir=' + profile, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let browserStderr = '';
    chrome.stderr.on('data', chunk => {
      browserStderr = (browserStderr + chunk.toString()).slice(-4096);
    });
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    let c;
    try {
      let endpointFaults = 0;
      const readEndpoint = (...args) => {
        if (endpointFaults === 0) {
          endpointFaults++;
          throw Object.assign(new Error('controlled Chrome endpoint lock'), {code:'EBUSY'});
        }
        if (endpointFaults === 1) {
          endpointFaults++;
          return '9222\n';
        }
        return fs.readFileSync(...args);
      };
      let endpoint;
      try {
        endpoint = await wizardEndpoint(profile, readEndpoint);
      } catch (error) {
        throw new Error(error.message + '; Chrome pid=' + chrome.pid + ', exit=' + chrome.exitCode
          + ', signal=' + chrome.signalCode + ', stderr=' + browserStderr, { cause: error });
      }
      c = mockups.cdp(endpoint);
      await c.ready;
      assert.equal(endpointFaults, 2, 'real Chrome startup must survive a locked and partial endpoint');
      const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
      const send = (method, params = {}) => c.send(method, params, sessionId);
      await send('Page.enable');
      await send('Runtime.enable');
      const evaluate = async (fn, arg) => {
        const result = await send('Runtime.evaluate', {
          expression: '(' + fn.toString() + ')(' + JSON.stringify(arg) + ')',
          awaitPromise: true, returnByValue: true
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      const until = async fn => mockups.withTimeout((async () => {
        while (!await evaluate(fn)) await new Promise(resolve => setTimeout(resolve, 25));
      })(), 10000, 'wizard input state: ' + fn.toString());
      const point = selector => evaluate(selector => {
        const el = document.querySelector(selector);
        if (!el) throw new Error('Missing control: ' + selector);
        el.scrollIntoView({ block: 'center' });
        const box = el.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }, selector);
      const click = async selector => {
        const p = await point(selector);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
      };
      const backStyle = async (root, selector) => {
        const style = await evaluate(({ root, selector }) => {
          const container = document.querySelector(root), back = container.querySelector(selector);
          const primary = container.querySelector('.setupprimary');
          const b = back.getBoundingClientRect(), p = primary.getBoundingClientRect();
          return {
            width: b.width, primaryWidth: p.width, left: b.left, primaryLeft: p.left,
            fill: getComputedStyle(back).backgroundColor, primaryFill: getComputedStyle(primary).backgroundColor
          };
        }, { root, selector });
        assert.ok(style.width > 100 && Math.abs(style.width - style.primaryWidth) < 1);
        assert.ok(Math.abs(style.left - style.primaryLeft) < 1);
        assert.notEqual(style.fill, 'rgba(0, 0, 0, 0)');
        assert.notEqual(style.fill, style.primaryFill);
      };
      for (const [width, display] of [[320, 'high-visibility'], [375, 'high-visibility'],
        [402, 'high-visibility'], [320, 'large'], [393, 'standard'], [430, 'standard'], [402, 'standard']]) {
        await send('Emulation.setDeviceMetricsOverride', {
          width, height: 844, deviceScaleFactor: 1, mobile: false
        });
        for (const input of ['pointer', 'Enter', 'Space']) {
          await send('Page.navigate', { url: 'http://127.0.0.1:' + mockups.server.address().port + '/index.html' });
          await until(() => !!window.__app && !!window.BirdTaxonomy);
          await evaluate(async ({ prepare, seen, display }) => {
            const A = window.__app;
            localStorage.setItem('ebird_seen_meta', JSON.stringify({ source: 'csv', count: 0, year: 2026 }));
            A.applyCapturedIdentity({ status: 'ok', displayName: 'Sample Birder' });
            await (0, eval)('(' + prepare + ')')(A, window, seen);
            localStorage.setItem('bc_api_verified_v1:' + A.bcProfile(), localStorage.getItem('ebird_api_key'));
            A.setDisplayProfile(display);
            // This guard measures real input ownership; provider readiness has separate controls.
            const create = window.SetupPrefetch.create;
            window.SetupPrefetch.create = (tasks, ...callbacks) => create(
              Object.fromEntries(Object.entries(tasks).map(([name, task]) => [
                name, { ...task, acquire: async () => ({ state: 'ready' }) }
              ])), ...callbacks);
          }, { prepare: mockups.preparePersonalFixture.toString(), seen, display });
          assert.equal(await evaluate(() => document.documentElement.clientWidth), width);
          if (input === 'pointer') {
            for (const step of ['key', 'home', 'region', 'seen', 'favorites', 'summary']) {
              await evaluate(step => {
                const A = window.__app, point = A.getHome();
                localStorage.setItem('bc_setup_home_draft_v1', JSON.stringify({
                  profile: A.bcProfile(), approved: true, point,
                  region: { status: 'ok', code: 'US-WA', label: 'Washington', ...point }
                }));
                localStorage.setItem('bc_setup_step_v1', step);
                A.openSetupSheet();
              }, step);
              if (step === 'summary') await until(() =>
                document.getElementById('setupSheetBody').dataset.setupStep === 'summary');
              assert.equal(await evaluate(() => document.getElementById('setupSheetBody').dataset.setupStep), step);
              await backStyle('#setupSheet', '#setupBack');
            }
            await evaluate(() => {
              const A = window.__app;
              localStorage.setItem('bc_api_verified_v1:', localStorage.getItem('ebird_api_key'));
              localStorage.setItem('bc_setup_step_v1', 'account');
              A.openSetupSheet();
            });
            await click('#setupConnectEbird');
            for (const id of ['setup-account-connected', 'setup-key-verified']) {
              assert.equal(await evaluate(() => document.getElementById('appSheet').dataset.infoId), id);
              await backStyle('#appSheet', '[data-setup-confirm-back]');
              await click('[data-setup-confirm-continue]');
            }
            await evaluate(() => {
              localStorage.removeItem('bc_setup_home_draft_v1');
              localStorage.setItem('bc_setup_step_v1', 'home');
              window.__app.openSetupSheet();
            });
            await click('#setupHomeEdit');
            assert.equal(await evaluate(() => document.activeElement.id), 'setupHomePlace');
            await send('Input.insertText', { text: '47.6062, -122.3321' });
            assert.deepEqual(await evaluate(() => ({
              focus: document.activeElement.id, value: document.getElementById('setupHomePlace').value
            })), { focus: 'setupHomePlace', value: '47.6062, -122.3321' });
            await click('#setupHomeFind');
            await until(() => document.getElementById('appSheet')?.dataset.infoId === 'setup-home-confirmed'
              && !document.getElementById('appSheet').hidden);
            await backStyle('#appSheet', '[data-setup-confirm-back]');
            await click('[data-setup-confirm-back]');
            assert.ok(await evaluate(() => {
              const map = document.getElementById('setupHomeMap'), box = map.getBoundingClientRect();
              return map.children.length && box.width > 100
                && box.height >= 18 * parseFloat(getComputedStyle(map).fontSize) - 1;
            }));
            await evaluate(() => {
              const draft = JSON.parse(localStorage.getItem('bc_setup_home_draft_v1'));
              draft.approved = true;
              draft.region = { status: 'ok', code: 'US-WA', label: 'Washington', ...draft.point };
              localStorage.setItem('bc_setup_home_draft_v1', JSON.stringify(draft));
              localStorage.setItem('bc_setup_step_v1', 'region');
              window.__app.renderSetupSheet();
            });
            await click('#setupNext');
            assert.equal(await evaluate(() => document.getElementById('appSheet').dataset.infoId), 'setup-home-replace');
            await backStyle('#appSheet', '[data-setup-confirm-back]');
            await click('[data-setup-confirm-back]');
          }
          await evaluate(seen => {
            const A = window.__app, key = A.personalListKey(A.personalListOwner());
            const original = window.fetch;
            const html = '<title>Personal Life List - eBird</title>'
              + '<link rel="canonical" href="https://ebird.org/lifelist/US-WA">'
              + '<header><button aria-label="Birder Sample Birder (fixture_login)">Account</button></header>'
              + '<select name="time"><option value="year" selected>year</option></select>'
              + '<main><h1>Life List</h1><p>Species Total: ' + seen.yearList.length + '</p>'
              + seen.yearList.map(row => '<li><a href="/species/' + row.code + '">' + row.name + '</a></li>').join('')
              + '</main>';
            window.fetch = (url, options) => /\/lifelist\//.test(url)
              ? new Promise(resolve => { window.__wizardRelease = () => resolve({
                ok: true, status: 200, text: async () => html
              }); }) : original(url, options);
            localStorage.removeItem(key);
            localStorage.removeItem('ebird_seen_setup_skipped');
            localStorage.removeItem('bc_setup_dismissed_v1');
            localStorage.setItem('bc_setup_step_v1', 'seen');
            A.openSetupSheet();
          }, seen);
          if (await evaluate(() => !!document.getElementById('setupFetchSeen'))) await click('#setupFetchSeen');
          try {
            await until(() => typeof window.__wizardRelease === 'function');
          } catch (error) {
            throw new Error(width + '/' + input + ': ' + JSON.stringify(await evaluate(() => ({
              title: document.getElementById('setupStepTitle')?.textContent,
              evidence: window.__app.personalListEvidence(),
              diagnostics: window.__dbg?.buf?.slice(-5)
            }))), { cause: error });
          }
          const p = await point('#setupSkipSeen');
          const key = input === 'Enter' ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }
            : { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' };
          if (input === 'pointer') {
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
          } else {
            await evaluate(() => document.getElementById('setupSkipSeen').focus());
            await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
          }
          await evaluate(() => window.__wizardRelease());
          await until(() => !!document.getElementById('setupContinue'));
          if (input === 'pointer') {
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
          } else {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key, autoRepeat: true });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key, text: undefined });
          }
          const state = await evaluate(() => ({
            step: document.getElementById('setupSheetBody').dataset.setupStep,
            dismissed: localStorage.getItem('bc_setup_dismissed_v1'),
            dialog: document.getElementById('appSheet')?.hidden ? '' : document.getElementById('appSheet')?.dataset.infoId,
            focus: document.activeElement?.hasAttribute('data-setup-confirm-continue')
          }));
          assert.equal(state.step, 'seen', width + '/' + input);
          assert.notEqual(state.dismissed, '1', width + '/' + input);
          assert.equal(state.focus, false, width + '/' + input + ' cannot focus a newly appearing primary');
          if (state.dialog) {
            assert.equal(state.dialog, 'setup-seen-skip', 'only the originally intended Skip may open');
            await backStyle('#appSheet', '[data-setup-confirm-back]');
            await click('[data-setup-confirm-back]');
          }
          await click('#setupContinue');
          await until(() => document.getElementById('appSheet')?.dataset.infoId === 'setup-seen-ready'
            && !document.getElementById('appSheet').hidden);
          await backStyle('#appSheet', '[data-setup-confirm-back]');
          await click('[data-setup-confirm-continue]');
          await until(() => document.getElementById('setupSheetBody').dataset.setupStep === 'favorites');
          assert.equal(await evaluate(() => document.getElementById('setupSheet').hidden), false);
          await click('#setupSkipFavorites');
          await until(() => document.getElementById('setupSheetBody').dataset.setupStep === 'summary');
          assert.equal(await evaluate(() => document.getElementById('setupSheetBody').dataset.setupStep), 'summary');
          assert.equal(await evaluate(() => document.getElementById('setupSheet').hidden),
            false, width + '/' + input + ' cannot dismiss the final summary automatically');
          assert.notEqual(await evaluate(() => localStorage.getItem('bc_setup_dismissed_v1')),
            '1', width + '/' + input + ' cannot finish setup before an explicit action');
          assert.equal(await evaluate(() => document.getElementById('setupDataResult').dataset.initialDataOutcome), 'ready');
          await click('#setupContinue');
          assert.equal(await evaluate(() => document.getElementById('setupSheet').hidden), true);
          assert.equal(await evaluate(() => localStorage.getItem('bc_setup_dismissed_v1')), '1');
          assert.equal(await evaluate(() => document.getElementById('menuPanel').hidden), false);
          assert.equal(await evaluate(() => !!document.getElementById('setupPrefetchBackground')), false);
        }
      }
    } finally {
      try {
        if (c) {
          await mockups.withTimeout(c.send('Browser.close'), 5000, 'wizard Browser.close').catch(() => {});
          c.close();
        }
        cleanupWizardProfile(profile);
        assert.equal(fs.existsSync(profile), false, 'wizard profile survived cleanup');
        await mockups.withTimeout(exited, 10000, 'wizard Chrome shutdown');
      } finally {
        await new Promise(resolve => mockups.server.close(resolve));
      }
    }
  });

test('F1218 exact-profile cleanup stops a surviving browser without stopping another browser',
  { timeout: 60000 }, async () => {
    const profiles = ['wizard-input-', 'wizard-input-ordinary-'].map(prefix =>
      fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    const browsers = profiles.map(profile => {
      const chrome = spawn(mockups.CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--enable-automation',
        '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      const browser = { chrome, stderr: '' };
      chrome.stderr.on('data', chunk => {
        browser.stderr = (browser.stderr + chunk.toString()).slice(-4096);
      });
      return browser;
    });
    let c, owned;
    try {
      const endpoints = await Promise.all(profiles.map((profile, index) =>
        wizardEndpoint(profile).catch(error => {
          const { chrome, stderr } = browsers[index];
          throw new Error(error.message + '; Chrome pid=' + chrome.pid + ', exit=' + chrome.exitCode
            + ', signal=' + chrome.signalCode + ', stderr=' + stderr, { cause: error });
        })));
      owned = mockups.cdp(endpoints[0]);
      await owned.ready;
      c = mockups.cdp(endpoints[1]);
      await c.ready;
      assert.ok((await mockups.withTimeout(owned.send('Browser.getVersion'),
        5000, 'owned browser readiness')).product);
      await cleanupWizardBrowser(profiles[0], owned);
      assert.equal(fs.existsSync(profiles[0]), false);
      const version = await mockups.withTimeout(c.send('Browser.getVersion'), 5000, 'ordinary browser preservation');
      assert.ok(version.product, 'the unrelated browser no longer answers CDP');
    } finally {
      if (owned) owned.close();
      const results = [];
      try {
        for (const [index, profile] of profiles.entries()) {
          try {
            if (index === 1 && c) await cleanupWizardBrowser(profile, c);
            else cleanupWizardProfile(profile);
            results.push(null);
          } catch (error) { results.push(error); }
        }
      } finally { if (c) c.close(); }
      if (results.some(Boolean)) throw new AggregateError(results.filter(Boolean),
        results.filter(Boolean).map(error => error.message).join('\n'));
    }
  });

test('F1245 graceful cleanup verifies exact ownership and preserves native proof within one deadline', async () => {
  for (const mode of ['owned', 'lookalike', 'identity-error', 'close-error', 'native-error', 'budget']) {
    const profile = 'fixture-profile', closed = [];
    let clock = 0, inventories = 0;
    const browser = { async send(method) {
      if (method === 'Browser.getBrowserCommandLine') {
        if (mode === 'identity-error') throw new Error('fixture identity denied');
        return {arguments:['--user-data-dir=' + profile + (mode === 'lookalike' ? '-ordinary' : '')]};
      }
      assert.equal(method, 'Browser.close');
      closed.push(method);
      if (mode === 'budget') clock += 6000;
      if (mode === 'close-error') throw new Error('fixture graceful close unavailable');
      return {};
    } };
    const cleanup = vm.runInNewContext('(' + cleanupWizardBrowser.toString() + ')', {
      Date:{now:() => clock}, mockups:{withTimeout:async (promise, budget) => {
        assert.ok(budget > 0 && budget <= 10000 - clock);
        return promise;
      }},
      cleanupWizardProfile(actual, run, deadline) {
        assert.equal(actual, profile);
        assert.ok(Number.isFinite(deadline) && deadline - clock <= 10000 - clock,
          'POSIX polling must inherit the same cleanup deadline');
        inventories++;
        const result = run('fixture inventory', [], {timeout:10000});
        if (result.status !== 0) throw new Error('fixture native inventory denied');
      }
    });
    const run = (command, args, options) => {
      assert.ok(options.timeout > 0 && options.timeout <= 10000 - clock,
        'graceful work cannot reset the native cleanup budget');
      return {status:mode === 'native-error' ? 1 : 0};
    };
    if (['lookalike', 'identity-error', 'native-error'].includes(mode)) {
      await assert.rejects(cleanup(profile, browser, run), /exact profile|identity denied|native inventory denied/);
    } else {
      await cleanup(profile, browser, run);
    }
    assert.equal(inventories, 1, mode + ' still requires native ownership proof');
    assert.equal(closed.length, ['lookalike', 'identity-error'].includes(mode) ? 0 : 1, mode);
  }
});

test('F1245 wizard startup waits for a readable complete endpoint without retrying permission errors',
  {timeout:1000}, async () => {
    const values = ['ENOENT', 'EBUSY', '9222\n', '0\n/devtools/browser/fixture',
      '65536\n/devtools/browser/fixture', '9222\n/devtools/page/fixture',
      '9222\n/devtools/browser/fixture'];
    let reads = 0, clock = 0;
    const endpoint = vm.runInNewContext('(' + wizardEndpoint.toString() + ')', {
      path, Date:{now:() => clock}, setTimeout(fn, delay) {
        assert.ok(clock < 15000, 'fixture polling escaped the startup budget');
        clock += delay; fn();
      },
      fs:{readFileSync(file, encoding) {
        assert.equal(file, path.join('fixture-profile', 'DevToolsActivePort'));
        assert.equal(encoding, 'utf8');
        const value = values[reads++];
        if (value === 'ENOENT' || value === 'EBUSY') throw Object.assign(new Error(value), {code:value});
        return value;
      }}
    });
    assert.equal(await endpoint('fixture-profile'), 'ws://127.0.0.1:9222/devtools/browser/fixture');
    assert.equal(reads, values.length);
    assert.equal(clock, 300);
    for (const code of ['EACCES', 'EIO']) {
      const error = Object.assign(new Error(code), {code});
      const denied = vm.runInNewContext('(' + wizardEndpoint.toString() + ')', {
        path, Date, fs:{readFileSync() { throw error; }}
      });
      await assert.rejects(denied('fixture-profile'), actual => actual === error);
    }
  });

test('F1245 wizard startup stops polling at its original shared deadline', {timeout:1000}, async () => {
  for (const value of ['EBUSY', '9222\n']) {
    let clock = 0, reads = 0;
    const endpoint = vm.runInNewContext('(' + wizardEndpoint.toString() + ')', {
      path, Date:{now:() => clock}, setTimeout(fn, delay) {
        assert.ok(clock < 15000, 'fixture polling escaped the startup budget');
        clock += delay; fn();
      },
      fs:{readFileSync() {
        reads++;
        if (value === 'EBUSY') throw Object.assign(new Error(value), {code:value});
        return value;
      }}
    });
    await assert.rejects(endpoint('fixture-profile'), error =>
      error.message.includes('startup timed out after 15000ms; polls=300; last endpoint='
        + (value === 'EBUSY' ? 'EBUSY' : 'incomplete or invalid')));
    assert.equal(clock, 15000);
    assert.equal(reads, 300);
  }
});

test('F1245 Windows cleanup distinguishes exited CIM records from live processes and inventory errors',
  {skip:process.platform !== 'win32', timeout:60000}, () => {
    for (const mode of ['exited', 'missing', 'alive', 'survivor', 'denied', 'inventory', 'stop-denied', 'exit-race']) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-input-state-'));
      let native;
      const run = (command, args, options) => {
        const fixture = `
$script:mode='${mode}'; $script:dead=$${mode === 'exited' ? 'true' : 'false'};
function Get-CimInstance {
  if ($script:mode -eq 'inventory') { throw 'fixture inventory denied' }
  [pscustomobject]@{ProcessId=90123451;CommandLine='--user-data-dir="${profile.replace(/'/g, "''")}"'}
  [pscustomobject]@{ProcessId=90123452;CommandLine='--user-data-dir="${profile.replace(/'/g, "''")}-ordinary"'}
}
function Get-Process {
  [CmdletBinding()]param([int]$Id)
  if ($Id -ne 90123451) { throw 'ordinary PID was queried' }
  if ($script:mode -eq 'denied') { throw 'fixture process access denied' }
  if ($script:mode -eq 'missing') {
    $record=[System.Management.Automation.ErrorRecord]::new(
      [ArgumentException]::new('fixture missing'), 'NoProcessFoundForGivenId',
      [System.Management.Automation.ErrorCategory]::ObjectNotFound, $Id)
    $PSCmdlet.ThrowTerminatingError($record)
  }
  [pscustomobject]@{HasExited=$script:dead}
}
function Stop-Process {
  [CmdletBinding()]param([int]$Id,[switch]$Force)
  if ($Id -ne 90123451) { throw 'ordinary PID was stopped' }
  if ($script:mode -eq 'stop-denied') { throw 'fixture stop denied' }
  if ($script:mode -eq 'exit-race') { $script:dead=$true; throw 'fixture exited during stop' }
  if ($script:dead) { throw 'fixture attempted stop after exit' }
  'FIXTURE_KILL_OWNED'
  if ($script:mode -ne 'survivor') { $script:dead=$true }
}
`;
        const index = args.indexOf('-EncodedCommand') + 1;
        const actual = Buffer.from(args[index], 'base64').toString('utf16le');
        const injected = args.slice();
        injected[index] = Buffer.from(fixture + actual, 'utf16le').toString('base64');
        native = spawnSync(command, injected, {...options, encoding:'utf8'});
        return native;
      };
      if (['exited', 'missing', 'alive', 'exit-race'].includes(mode)) {
        cleanupWizardProfile(profile, run);
      } else {
        assert.throws(() => cleanupWizardProfile(profile, run), /cleanup could not be verified/);
      }
      assert.equal(native.error, undefined, mode + ' must finish within the unchanged helper deadline');
      const kills = (native.stdout.match(/FIXTURE_KILL_OWNED/g) || []).length;
      assert.equal(kills, mode === 'alive' ? 1 : mode === 'survivor' ? 10 : 0, mode);
      if (mode === 'denied') assert.match(native.stderr, /fixture process access denied/);
      if (mode === 'inventory') assert.match(native.stderr, /fixture inventory denied/);
      if (mode === 'stop-denied') assert.match(native.stderr, /fixture stop denied/);
      assert.equal(fs.existsSync(profile), false);
    }
  });

test('F1245 layout cleanup distinguishes exited CIM entries from live owned processes',
  {skip:process.platform !== 'win32', timeout:120000}, () => {
    for (const mode of ['exited', 'missing', 'alive', 'delayed-exit', 'late-owned', 'survivor', 'denied', 'inventory',
      'stop-denied', 'exit-race']) {
      const result = spawnSync(process.execPath, [
        '--require', path.join(__dirname, 'fixtures', 'audit-lifecycle.cjs'),
        path.join(ROOT, 'assets', 'audit-overflow.js'), '393', '1'
      ], {cwd:ROOT, encoding:'utf8', timeout:20000, env:{
        ...process.env, AUDIT_TIMEOUT_MS:'10000', AUDIT_ATTEMPTS:'1',
        AUDIT_LIFECYCLE_HELPERS:'windows-native-' + mode,
        AUDIT_LIFECYCLE_CLEANUP:'clean', AUDIT_LIFECYCLE_REPORT:'empty'
      }});
      const output = result.stdout + result.stderr;
      assert.equal(result.error, undefined, mode + ': ' + output);
      assert.doesNotMatch(output, /ordinary PID was (queried|stopped)/, mode);
      if (['exited', 'missing', 'alive', 'delayed-exit', 'late-owned', 'exit-race'].includes(mode)) {
        assert.equal(result.status, 1, mode + ': ' + output);
        assert.match(output, /FIXTURE missing/, mode);
        assert.doesNotMatch(output, /AUDIT INFRASTRUCTURE FAILURE/, mode);
      } else {
        assert.equal(result.status, 3, mode + ': ' + output);
        assert.match(output, /AUDIT INFRASTRUCTURE FAILURE/, mode);
        assert.doesNotMatch(output, /FIXTURE missing|nothing overflows/, mode);
      }
    }
  });

test('F1218 helper failure, timeout and surviving children fail even if the directory was removed', () => {
  for (const platform of ['win32', 'linux']) {
    const cleanup = vm.runInNewContext('(' + cleanupWizardProfile.toString() + ')', {
      fs, Buffer, Date, process: { platform }
    });
    for (const result of [{ status: 1 }, {
      status: null, error: new Error('ETIMEDOUT'), stderr: 'controlled native cleanup progress'
    }]) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-input-fault-'));
      assert.throws(() => cleanup(profile, (command, args, options) => {
        assert.ok(options.timeout > 0 && options.timeout <= 10000, 'native cleanup must be bounded');
        return result;
      }), error => /cleanup could not be verified/.test(error.message)
        && (!result.stderr || error.message.includes(result.stderr)));
      assert.equal(fs.existsSync(profile), false, 'directory cleanup must still be attempted');
    }
  }
});

test('F1231 POSIX cleanup polls delayed exits, excludes other profiles and fails closed within its shared deadline', () => {
  for (const mode of ['delayed', 'survivor', 'inventory', 'denied', 'deadline']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-input-posix-'));
    const killed = [], ownedPid = 90123451, otherPid = 90123452;
    let inventories = 0, pauses = 0, clock = 0;
    const cleanup = vm.runInNewContext('(' + cleanupWizardProfile.toString() + ')', {
      fs, Date: { now: () => clock },
      process: { platform: 'linux', kill(pid, signal) {
        killed.push(pid);
        assert.equal(signal, 'SIGKILL');
        if (mode === 'denied') throw Object.assign(new Error('EPERM fixture'), { code: 'EPERM' });
      } },
      Atomics: { wait(array, index, value, delay) { pauses++; clock += delay; } }
    });
    const run = (command, args, options) => {
      assert.equal(command, 'ps');
      assert.deepEqual(Array.from(args), ['-axo', 'pid=,args=']);
      assert.ok(options.timeout > 0 && options.timeout <= 10000 - clock);
      inventories++;
      if (mode === 'inventory') return { status: 1, stderr: 'inventory fixture' };
      if (mode === 'deadline') clock = 9999;
      const present = mode !== 'delayed' || inventories < 3;
      return { status: 0, stdout: (present ? `${ownedPid} chrome --user-data-dir="${profile}"\n` : '')
        + `${otherPid} chrome --user-data-dir="${profile}-ordinary"\n` };
    };
    if (mode === 'delayed') {
      cleanup(profile, run);
      assert.ok(inventories >= 3 && pauses >= 1, 'a successful signal is not proof of process exit');
    } else {
      const reason = { survivor: 'processes survived', inventory: 'inventory fixture',
        denied: 'EPERM fixture', deadline: 'deadline exceeded' }[mode];
      assert.throws(() => cleanup(profile, run), error =>
        error.message.includes(reason) && error.cause.message.includes(reason));
    }
    assert.ok(killed.every(pid => pid === ownedPid), 'ordinary or prefix-matching profiles cannot be killed');
    assert.ok(inventories <= 11 && clock <= 10000, 'verification has a shared bounded budget');
    assert.equal(fs.existsSync(profile), false, 'directory cleanup is still attempted after process failure');
  }
});

test('F1049 offline mockups read bundled section notes while unseeded remote sources remain pending', () => {
  const start = source.indexOf('var HANG = function (url, init)');
  const end = source.indexOf('\n  window.fetch = HANG;',start);
  assert.ok(start >= 0 && end > start);
  assert.match(source,/var bundledFetch = window\.fetch\.bind\(window\)/);
  const calls = [], response = {ok:true};
  const fetch = vm.runInNewContext(source.slice(start,end)+'; HANG;',{
    Promise,DOMException,bundledFetch(url) { calls.push(url); return response; }
  });
  assert.equal(fetch('section-docs.json'),response,
    'primary help cannot wait on a deliberately hanging fixture source');
  assert.ok(fetch('https://api.ebird.org/v2/data/obs/US-WA/recent') instanceof Promise);
  assert.deepEqual(calls,['section-docs.json'],'this must not enable live external requests');
});

test('F359 mockup preparation timeout rejects a hung fixture by shot name', async () => {
  await assert.rejects(
    mockups.withTimeout(new Promise(() => {}), 5, 'section-spLookupBtn preparation'),
    /section-spLookupBtn preparation timed out after 5ms/
  );
});

test('F1273 actual gallery decodes bundled photos when HTTP image requests are cancelled',
  {timeout:120000}, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-photo-'));
    const preload = path.join(output, 'cancel-images.cjs');
    const target = path.join(ROOT, 'assets', 'mockups.js');
    const needle = 'const birdRequests = new Map(), birdNetworkEvents = [];';
    const block = needle + `
      let blockedFixturePhoto = false;
      c.onEvent('Fetch.requestPaused', (p,s) => {
        if (s !== sessionId) return;
        if (!blockedFixturePhoto) { console.error('F1273_HTTP_IMAGE_ABORTED'); blockedFixturePhoto = true; }
        c.send('Fetch.failRequest', {requestId:p.requestId,errorReason:'Aborted'}, sessionId);
      });
      await c.send('Fetch.enable', {patterns:[
        {urlPattern:'*/assets/birds/*',resourceType:'Image',requestStage:'Request'}
      ]}, sessionId);
    `;
    fs.writeFileSync(preload, `
      const fs=require('node:fs'),path=require('node:path'),read=fs.readFileSync;
      fs.readFileSync=function(file,...args) {
        const data=read.call(this,file,...args);
        if(typeof file!=='string'||path.resolve(file)!==${JSON.stringify(target)})return data;
        const text=Buffer.isBuffer(data)?data.toString('utf8'):data;
        const needle=${JSON.stringify(needle)};
        if(text.split(needle).length!==2)throw new Error('Photo fault injection must bind once');
        const changed=text.replace(needle,${JSON.stringify(block)});
        return Buffer.isBuffer(data)?Buffer.from(changed,'utf8'):changed;
      };
    `);
    try {
      const result = spawnSync(process.execPath, ['--require', preload, target,
        '--only','menu','--width','402','--scale','1.3','--out',output],
      {cwd:ROOT,encoding:'utf8',timeout:110000});
      assert.match(result.stderr, /F1273_HTTP_IMAGE_ABORTED/, 'fault must actually occur');
      assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
      assert.match(result.stdout, /1 mockup\(s\)/);
      assert.ok(fs.existsSync(path.join(output, 'menu-402px.png')));
    } finally { fs.rmSync(output, {recursive:true,force:true}); }
  });

test('F1049/F1051-F1055 release galleries render primary help and production Common/Big days/Convoys',
  {timeout:120000}, () => {
    const output=fs.mkdtempSync(path.join(os.tmpdir(),'approved-release-'));
    try {
      const shots=['section-easyBtn','section-cklBtn','section-convoyBtn','birdgenkey'];
      const result=spawnSync(process.execPath,[
        path.join(ROOT,'assets','mockups.js'),'--only',shots.join(','),
        '--width','402','--scale','1.75','--out',output
      ],{cwd:ROOT,encoding:'utf8',timeout:110000});
      assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
      assert.match(result.stdout,/4 mockup\(s\)/);
      for (const shot of shots) assert.ok(fs.existsSync(path.join(output,shot+'-402px.png')),shot);
    } finally {fs.rmSync(output,{recursive:true,force:true});}
  });

test('F1319 actual Contents refresh gestures keep visible action feedback usable in real Chrome',
  { timeout: 120000 }, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-refresh-f1319-'));
    const preload = path.join(output, 'pending-actions.cjs');
    const target = path.join(ROOT, 'assets', 'mockups.js');
    const needle = '  const shots = ONLY.length';
    const extra = `
      const recentMenu = SHOTS.find(shot => shot.id === 'menu');
      for (const action of ['normal', 'latest', 'pull']) SHOTS.push({
        ...recentMenu, id: 'f1319-' + action,
        prep: recentMenu.prep.replace(/return true;\\s*$/, \`
          var refresh = document.getElementById('recentBirdGenRefresh');
          if (refresh.disabled) throw new Error('F1319 fixture must start idle');
          if ('\${action}' === 'pull') {
            (document.scrollingElement || document.documentElement).scrollTop = 0;
            for (var kind of ['touchstart','touchmove','touchend']) {
              var event = new Event(kind, {bubbles:true});
              Object.defineProperty(event, 'touches', {value: kind === 'touchend' ? []
                : [{clientX:100,clientY:kind === 'touchstart' ? 100 : 190}]});
              document.dispatchEvent(event);
            }
          } else document.getElementById('\${action}' === 'latest'
            ? 'recentBirdGenLatest' : 'recentBirdGenRefresh').click();
          await new Promise(resolve => setTimeout(resolve, 0));
          if (!refresh.disabled || refresh.textContent !== 'Checking...') {
            throw new Error('F1319 actual gesture has no visible pending feedback');
          }
          var range = document.createRange();
          range.selectNodeContents(refresh);
          var text = range.getBoundingClientRect();
          if (text.width <= 1 || text.height <= 1) throw new Error('F1319 pending text is clipped');
          for (var id of ['recentBirdGenRefresh','recentBirdGenLatest','recentBirdGenOpen']) {
            var rect = document.getElementById(id).getBoundingClientRect();
            if (rect.width < 44 || rect.height < 44 || rect.left < 0 || rect.right > innerWidth) {
              throw new Error('F1319 pending action is too small or overflows: ' + id);
            }
          }
          if (!document.getElementById('recentBirdGenStatus').classList.contains('vh')) {
            throw new Error('F1319 must preserve debug-only technical diagnostics');
          }
          return true;
        \`)
      });
    `;
    fs.writeFileSync(preload, `
      const fs=require('node:fs'),path=require('node:path'),read=fs.readFileSync;
      fs.readFileSync=function(file,...args) {
        const data=read.call(this,file,...args);
        if(typeof file!=='string'||path.resolve(file)!==${JSON.stringify(target)})return data;
        const text=String(data),needle=${JSON.stringify(needle)};
        if(text.split(needle).length!==2)throw new Error('F1319 actual shot hook drifted');
        const changed=text.replace(needle,${JSON.stringify(extra)}+needle);
        return Buffer.isBuffer(data)?Buffer.from(changed):changed;
      };
    `);
    try {
      for (const scale of ['1', '1.75']) {
        const result = spawnSync(process.execPath, ['--require', preload, target,
          '--only', 'f1319-normal,f1319-latest,f1319-pull', '--width', '402',
          '--scale', scale, '--out', path.join(output, scale)],
        { cwd: ROOT, encoding: 'utf8', timeout: 55000 });
        assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
        assert.match(result.stdout, /3 mockup\(s\)/);
      }
    } finally { fs.rmSync(output, { recursive: true, force: true }); }
  });

test('F987/F992/F993 release menu and Year List prepare production preview, glossary and watch states',
  { timeout: 120000 }, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'release-menu-f987-'));
    try {
      const result = spawnSync(process.execPath, [
        path.join(ROOT, 'assets', 'mockups.js'), '--only', 'menu,section-myYearBody',
        '--width', '402', '--out', output,
      ], { cwd: ROOT, encoding: 'utf8', timeout: 110000 });
      assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
      assert.match(result.stdout, /2 mockup\(s\)/);
      assert.ok(fs.existsSync(path.join(output, 'menu-402px.png')));
      assert.ok(fs.existsSync(path.join(output, 'section-myYearBody-402px.png')));
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

test('F910 actual Bird Gen release preparation accepts the weekly Ruff discovery', { timeout: 120000 }, () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'birdgen-f910-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, 'assets', 'mockups.js'),
      '--only', 'section-surgeBtn', '--out', output,
    ], { cwd: ROOT, encoding: 'utf8', timeout: 110000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /1 mockup\(s\)/);
    assert.ok(fs.readdirSync(output).some(name => /section-surgeBtn.*\.png$/.test(name)),
      'real fixture preparation did not produce its Bird Gen image');
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});

test('F1245 navigation waits for its own session, frame and loader, not a stale load', {timeout:1000}, async () => {
  let receive, removed = 0, settled = false;
  const client = {
    onEvent(name, handler) {
      assert.equal(name, 'Page.lifecycleEvent');
      receive = handler;
      return () => { removed++; };
    },
    async send() { return {frameId:'owned',loaderId:'wanted'}; },
  };
  const pending = mockups.navigateMockupFrame(client, 'session', {url:'http://fixture.test'}, 'shot')
    .then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  for (const [frameId, loaderId, session] of [
    ['owned','old','session'], ['other','wanted','session'], ['owned','wanted','other'],
  ]) {
    receive({name:'load',frameId,loaderId}, session);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'unrelated loads cannot certify the requested document');
  }
  receive({name:'DOMContentLoaded',frameId:'owned',loaderId:'wanted'}, 'session');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'DOM readiness alone does not finish subresource loading');
  receive({name:'load',frameId:'owned',loaderId:'wanted'}, 'session');
  await pending;
  assert.equal(removed, 1);
});

test('F1245 navigation accepts its load before the command reply and rejects protocol failure', {timeout:1000}, async () => {
  let receive, removed = 0;
  const client = {
    onEvent(name, handler) { receive = handler; return () => { removed++; }; },
    async send() {
      receive({name:'load',frameId:'owned',loaderId:'wanted'}, 'session');
      return {frameId:'owned',loaderId:'wanted'};
    },
  };
  assert.equal(await mockups.navigateMockupFrame(client, 'session', {}, 'early load'), 'owned');
  for (const result of [{errorText:'net::ERR_ABORTED'}, {frameId:'owned'}]) {
    client.send = async () => result;
    await assert.rejects(mockups.navigateMockupFrame(client, 'session', {}, 'failed shot'),
      /failed shot: navigation failed/);
  }
  assert.equal(removed, 3, 'success and errors must detach their navigation listeners');
});

test('F1245 navigation without a matching load stays bounded and removes its listener', {timeout:1000}, async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let removed = 0;
  const client = {
    onEvent() { return () => { removed++; }; },
    send() { return new Promise(() => {}); },
  };
  const pending = assert.rejects(
    mockups.navigateMockupFrame(client, 'session', {}, 'hung shot'),
    /hung shot navigation timed out/);
  t.mock.timers.tick(10000);
  await pending;
  assert.equal(removed, 1);
});

test('F951/F967/F970/F971 Bird Gen, PPTE and Date/Count Ticks render production styles', {timeout:120000}, () => {
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'birdgen-f951-'));
  try {
    for (const [width,scale] of [[402,1],[320,1.75]]) {
      const result=spawnSync(process.execPath,[
        '--require',path.join(__dirname,'fixtures','mockup-navigation.cjs'),
        path.join(ROOT,'assets','mockups.js'),'--only','f951-birdgen-all,ppte,section-lastNewBtn,f970-ticks-expanded,section-massBtn,section-ppteBtn',
        '--width',String(width),'--scale',String(scale),'--out',output
      ],{cwd:ROOT,encoding:'utf8',timeout:110000});
      assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
      assert.match(result.stdout,/CONTROLLED_INITIAL_IFRAME_DELAY=5000/);
      assert.match(result.stdout,/6 mockup\(s\)/);
      assert.ok(fs.existsSync(path.join(output,'ppte-'+width+'px.png')),
        'the dedicated PPTE release fixture must pass its real preparation guards');
      for (const id of ['section-lastNewBtn','f970-ticks-expanded','section-massBtn','section-ppteBtn']) {
        assert.ok(fs.existsSync(path.join(output,id+'-'+width+'px.png')),
          id+' must exercise its actual default/expanded contributor state');
      }
      const image=fs.readFileSync(path.join(output,'f951-birdgen-all-'+width+'px.png'));
      assert.equal(image.readUInt32BE(16),width*2,'CSS pixels use the existing 2x capture scale');
      assert.ok(image.readUInt32BE(20)>1600,'every category must be captured, not cropped');
    }
  } finally {fs.rmSync(output,{recursive:true,force:true});}
});

test('F1317 default Twitches gallery isolates prior pending work and verifies feed provenance', { timeout: 180000 }, () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bird-twitch-provenance-'));
  const shots = mockups.SHOTS.slice(0,
    mockups.SHOTS.findIndex(shot => shot.id === 'section-refreshBtn') + 1);
  assert.ok(shots.length > 1, 'exercise the actual preceding gallery producers');
  try {
    for (const scale of [1, 1.75]) {
      const result = spawnSync(process.execPath, [
        path.join(ROOT, 'assets', 'mockups.js'), '--only', shots.map(shot => shot.id).join(','),
        '--width', '402', '--scale', String(scale), '--out', output,
      ], { cwd: ROOT, encoding: 'utf8', timeout: 80000 });
      assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
      assert.ok(result.stdout.includes(shots.length + ' mockup(s)'));
      assert.ok(fs.existsSync(path.join(output, 'section-refreshBtn-402px.png')));
    }
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('F830 Twitches preparation acquires exact personal membership before rendering', () => {
  const twitch = source.slice(source.indexOf('async function prepareTwitches('),
    source.indexOf('async function waitFor(', source.indexOf('async function prepareTwitches(')));
  assert.match(twitch, /await preparePersonalFixture\(A, document\.defaultView,/);
  assert.ok(twitch.indexOf('await preparePersonalFixture(') < twitch.indexOf('A.refresh()'));
  assert.doesNotMatch(twitch, /disabled\s*=\s*false|allowDisabled/);
  assert.equal(typeof mockups.preparePersonalFixture, 'function');
  const birdGen = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (at === 'rankBtn')"));
  assert.match(birdGen, /await preparePersonalFixture\(A, document\.defaultView,/);
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.match(rank, /A\.bcProfile\(\), A\.identityRevision\(\), 'Sample Birder'/);
  assert.match(rank, /'ebird_rankhist:' \+ historyOwner/);
  assert.match(rank, /'bc_board_v1:' \+ historyOwner/);
  assert.match(rank, /A\.renderRankPair\(\{boards:\{spp:speciesBoard,cl:checklistBoard\}/);
  assert.match(rank, /Top 100 gallery lost production dual-board controls/);
});

test('release mockups include exactly one section shot per visible menu entry', () => {
  const expected = mockups.CONTRACT.menu.map((item) => item.at).sort();
  const actual = mockups.SECTION_SHOTS.map((shot) => shot.at).sort();
  assert.deepEqual(actual, expected,
    'the screenshot set must derive from report-contract.json, not a hand list');
  assert.equal(new Set(actual).size, actual.length, 'no menu section is rendered twice');
  assert.equal(mockups.SHOTS.length,
    1 + mockups.CONTRACT.menu.length + mockups.EXTRA_SHOTS.length,
    'Contents + every section + explicit extra states');
  assert.deepEqual(mockups.REVIEW_SHOTS.map((shot) => shot.id),
    ['f1083-setup-account', 'f1083-setup-connected', 'f1083-setup-account-change',
      'f1083-setup-key', 'f1083-setup-verified', 'f1083-setup-key-retry',
      'f1083-setup-application', 'f1083-setup-home', 'f1083-setup-candidate',
      'f1083-setup-home-change', 'f1083-setup-region', 'f1083-setup-replacement',
      'f1083-setup-seen-waiting', 'f1083-setup-seen', 'f1083-setup-seen-ready',
      'f1083-setup-seen-skip', 'f1083-setup-summary',
      'f1288-setup-loading', 'f1288-setup-loading-more',
      'f1213-migration-current', 'f1213-migration-older', 'f1213-migration-recent',
      'f928-watch-patches', 'nearby-competitors-f857', 'nuthatch-icons-f829', 'stakeoutreachable-f389', 'stakeoutdistance-f389',
    'stakeoutchecklists-progressive', 'stakeoutmixed-f634', 'stakeoutpins-f837',
    'stakeoutspts-notes-off', 'stakeoutspts-notes-on', 'stakeoutnotes-popup',
      'onboardingregion', 'onboardinghome',
      'birdgenloading', 'hawaiiemptybirdgen', 'hawaiiemptyticks',
      'abayearrefresh', 'favoritesregion', 'spuhcompact', 'birdspcompact',
      'birdspdetail', 'spuhdetail', 'spuhinfo',
      'stakeoutreports', 'meganearest',
      'f629-nightly', 'f629-birdgen', 'f630-birdgen-top', 'f1110-sensitive', 'f951-birdgen-all', 'f1102-foy-many',
      'f1130-menu-recommendation', 'f1131-collapsed-menu'],
    'focused review states stay available without inflating the release contract');
  for (const id of ['f1130-menu-recommendation', 'f1131-collapsed-menu']) {
    assert.ok(!mockups.SHOTS.some(shot => shot.id === id),
      id + ' must remain optional, not a mandatory release image');
  }
  assert.equal(mockups.REVIEW_SHOTS.find((shot) => shot.id === 'spuhcompact')
    .maxHostHeight, undefined,
  'the approved medium-card peep result is still capped by the superseded layout');
});

test('F1014 actual release Stakeout galleries retain verified current Mega membership',
  { timeout: 120000 }, () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'release-stakeout-f1014-'));
    try {
      const result = spawnSync(process.execPath, [
        '--require', path.join(ROOT, 'tests', 'fixtures', 'mockup-stakeout.cjs'),
        path.join(ROOT, 'assets', 'mockups.js'),
        '--only', 'section-spLookupBtn,stakeoutdetail',
        '--width', '402', '--out', output,
      ], { cwd: ROOT, encoding: 'utf8', timeout: 110000 });
      assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
      assert.match(result.stdout, /2 mockup\(s\)/);
      assert.match(result.stdout, /CONTROLLED_HERO_IMAGE_DELAY=5000/);
      const captures = result.stdout.split('\n')
        .filter(line => line.startsWith('CONTROLLED_HERO_CAPTURE='))
        .map(line => JSON.parse(line.slice('CONTROLLED_HERO_CAPTURE='.length)));
      assert.equal(captures.length, 2, 'both actual Stakeout shots must report image readiness');
      assert.ok(captures.every(capture => capture.decoded && capture.ratio),
        'capture must wait for decoded, production-fitted hero photos');
      assert.ok(captures.some(capture => capture.queued > 0),
        'the controlled production photo queue must still have late work');
      for (const shot of ['section-spLookupBtn', 'stakeoutdetail']) {
        assert.ok(fs.existsSync(path.join(output, shot + '-402px.png')),
          'mandatory current-Mega Stakeout image missing: ' + shot);
      }
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

test('F506 release mockups require the full Stakeout card with Notes off and on', () => {
  const notesOff = mockups.SECTION_SHOTS.find((item) => item.at === 'spLookupBtn');
  const notesOn = mockups.EXTRA_SHOTS.find((item) => item.id === 'stakeoutdetail');
  assert.ok(notesOff && notesOn, 'both mandatory Stakeout Notes states are registered');
  assert.ok(notesOff.expects.includes(
    '#spLookupResults.stakeoutSpeciesCard-details > li'));
  assert.ok(notesOn.expects.includes(
    '#spLookupResults.stakeoutSptsMock.stakeoutSpeciesCard-details'));
  assert.ok(notesOn.expects.includes('#spLookupResults .bchero'));
  assert.equal(notesOn.fullPage, true,
    'Notes on must capture its complete evidence and Iconic-hotspot page');
  assert.equal(notesOn.freshApp, true,
    'Notes on must not inherit Notes-off lookup state in the release gallery');
  assert.match(source, /Sharp-tailed Sandpiper Stakeout/);
  assert.match(source, /userDisplayName: 'Kellie Sagen'/);
  assert.match(source, /durationHrs: 1 \+ 14 \/ 60/);
  assert.match(source, /observationComments:/);
  assert.match(source, /prepareStakeoutSpts\(A, document, sec, true\)/);
  const mockStyle = source.slice(
    source.indexOf('function ensureMockStyle'),
    source.indexOf('function mockPhoto'));
  assert.doesNotMatch(mockStyle, /stakeoutSpeciesCard|bchero|stakeoutPlaceDetails/,
    'release fixtures must not restyle the production species/checklist cards');
  assert.match(postWorkflow,
    /for VARIANT in iphone-11 iphone-17-pro iphone-17-pro-large iphone-17-pro-max-magnification/,
    'post-release must verify every required device variant');
  assert.doesNotMatch(indexSource, /stakeoutSpeciesCard-compact/,
    'the removed top-level Compact Stakeout card is still shipped');
  assert.match(indexSource, /#spLookupMap \{ aspect-ratio: 16 \/ 7; \}/);
});

test('F931/F933 release galleries include production PPTE and complete alert-key states', () => {
  for (const id of ['ppte', 'birdgenkey']) {
    const shot = mockups.EXTRA_SHOTS.find(item => item.id === id);
    assert.ok(shot, `${id} must be mandatory in every release gallery, not review-only`);
    assert.ok(mockups.SHOTS.includes(shot));
    assert.match(shot.prep, /A\.renderSurge\(/);
  }
  const ppte = mockups.EXTRA_SHOTS.find(item => item.id === 'ppte');
  assert.match(ppte.prep, /A\.ppteEvents\(/);
  assert.ok(ppte.expects.includes('#surgeResults .ppte-event-link'));
  assert.ok(ppte.expects.includes('#surgeResults .ppte-bird-composite'));
  const key = mockups.EXTRA_SHOTS.find(item => item.id === 'birdgenkey');
  assert.ok(key.expects.includes('#appSheet:not([hidden]) [data-alert-type-key]'));
});

test('every menu section declares representative fixture data or an intentional static surface', () => {
  const expected = mockups.CONTRACT.menu.map((item) => item.at).sort();
  const declared = Object.keys(mockups.STUB_SPEC).sort();
  assert.deepEqual(declared, expected,
    'a new menu entry must choose a stub kind before the release gallery passes');

  const allowed = new Set([
    'birdgen', 'weather', 'bird', 'ranking', 'hotspot', 'favorites', 'species-search',
    'hotspot-search', 'stakeout-merged', 'mega-index', 'patches',
    'checklists', 'birdcast', 'help', 'migration', 'foy', 'events', 'static',
  ]);
  for (const shot of mockups.SECTION_SHOTS) {
    assert.ok(allowed.has(shot.kind),
      `${shot.at} has no supported representative fixture kind`);
    assert.ok(shot.host, `${shot.at} has no real result host`);
    assert.match(shot.prep, /FIX\.before\(/, `${shot.at} skips fixture setup`);
    assert.match(shot.prep, /FIX\.prepare\(/, `${shot.at} never paints fixture data`);
  }
  const staticAts = mockups.SECTION_SHOTS
    .filter((shot) => shot.kind === 'static').map((shot) => shot.at).sort();
  assert.deepEqual(staticAts, ['settingsPanel'],
    'only genuinely data-free documentation/settings surfaces may skip stub rows');
});

test('F607 BirdCast mockups seed the production level and county-count surfaces', () => {
  assert.doesNotMatch(source, /18,400 birds\/km|HIGH migration|northwest winds 7 mph/,
    'the release gallery must not retain old fabricated BirdCast copy');
  assert.doesNotMatch(sectionsSource, /42,000 birds\/km|Peak 01:00|mostly NNE/,
    'the section catalog still claims unsupported BirdCast detail');
  assert.match(source, /forecast:\s*\{\s*level:\s*'High'/,
    'the mockup does not seed the representative official forecast level');
  assert.match(source, /birds:\s*1825700/,
    'the mockup does not seed the representative county total');
  assert.match(source, /A\.renderBirdcast\(new Date\('2026-09-09T19:00:00Z'\), snapshot\)/,
    'the mockup does not render the production BirdCast surface with deterministic data');
  assert.doesNotMatch(indexSource, /Tonight\\u2019s forecast|Tonight’s forecast/);
  assert.doesNotMatch(indexSource, /Lights Out guidance|birdcast\.org\/lights-out/);
  assert.match(indexSource, /Live migration map/);
  assert.match(source, /migrants:\s*\[/,
    'the mockup does not seed representative expected migrants');
  assert.match(indexSource, /Migration watch/);
  assert.match(indexSource, /migration-event-proof/);
  assert.match(indexSource, /SpeciesCards\.list\('small'/,
    'expected migrants do not use the shared small species card renderer');
  assert.match(source, /REPRESENTATIVE BIRDCAST DATA/);
  assert.match(indexSource, /class="birdcast-alert-icon"/);
  assert.match(indexSource, /class="birdcast-alert-count"/);
});

test('F207/F318 review mockups render the actual missing-region and missing-Home steps', () => {
  const region = mockups.REVIEW_SHOTS.find((shot) => shot.id === 'onboardingregion');
  const home = mockups.REVIEW_SHOTS.find((shot) => shot.id === 'onboardinghome');
  assert.equal(region.menuState, true,
    'a legitimate sparse first-run menu uses the explicit menu-state threshold');
  assert.match(region.prep, /A\.setActiveReport\(''\)/);
  assert.match(region.prep, /regionChooseBtn/);
  assert.match(home.prep, /A\.homeKey\('lat'\)/);
  assert.match(home.prep, /homeHereBtn/);
});

test('blank detection inspects the active section and requires its data marker', () => {
  assert.match(source, /sec\.dataset\.mockReady === 'true'/,
    'the active section must declare that its fixture finished');
  assert.match(source, /host\.getAttribute\('data-mock-data'\) === 'true'/,
    'the configured real result host must contain representative data');
  assert.match(source, /problems\.push\('blank static surface'\)/,
    'footer/navbar text cannot make a thin static section pass');
  assert.match(source, /problems\.push\('blank data surface'\)/,
    'footer/navbar text cannot make an unmarked data section pass');
  assert.match(source, /problems\.push\('loading'\)/,
    'visible loading states fail the shot');
  assert.match(source, /problems\.push\('global loading'\)/,
    'the app-wide progress bar cannot remain visible in a finished shot');
  const staticStart = source.indexOf("if (spec.kind === 'static')");
  const staticEnd = source.indexOf('host.innerHTML', staticStart);
  assert.ok(staticStart > 0 && staticEnd > staticStart,
    'the static fixture branch is bracketed by stable setup statements');
  assert.match(source.slice(staticStart, staticEnd), /A\.fgProgressReset\(\)/,
    'the static Settings fixture does not clear work left by earlier gallery shots');
  assert.match(source.slice(staticStart, staticEnd),
    /A\.LOADERS\[at\].*await A\.LOADERS\[at\]\.fn\(\)/s,
    'a loader-backed static surface is marked ready before its authored content is painted');
  assert.match(source, /problems\.push\('disabled controls'\)/,
    'visible disabled-loader states fail the shot');
  assert.match(source, /FIXTURE CHANGED AFTER READY/,
    'a later asynchronous overwrite is detected');
  assert.match(source, /STUB NOT READY/,
    'a missing fixture exits as a named failure rather than writing a blank PNG');
});

test('blank-shot decisions reject missing data instead of merely existing in source', () => {
  const ready = {
    at: 'easyBtn', expectedAt: 'easyBtn', ready: true, isStatic: false,
    sectionVisible: true, hostVisible: true, data: true, text: 120,
    controls: 2, inCapture: true, loading: [], disabled: [], missing: [],
    mapReady: true, globalLoading: false, captureMissing: [],
  };
  assert.deepEqual(mockups.shotReadinessProblems(ready), [],
    'a populated data section is ready');
  assert.deepEqual(mockups.shotReadinessProblems({ ...ready, data: false }),
    ['blank data surface'],
    'a navbar/footer cannot make an unmarked result host pass');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, loading: ['Loading recent reports…'],
  }), ['loading'], 'a visible loading state cannot be captured as finished');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, globalLoading: true,
  }), ['global loading'],
  'the app-wide eBird progress bar cannot be captured as finished');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, missing: ['#easyResults .hscard'],
  }), ['missing expected components'],
  'a generic card cannot replace the production shape a shot promises');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, captureMissing: ['#stakeHsResults .stakeHsNearbyChecklists .cklcard-sm'],
  }), ['expected content outside capture'],
  'expected evidence below a fixed screenshot cap cannot pass readiness');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, hostHeight: 341, maxHostHeight: 340,
  }), ['oversized result host'],
  'a default result host that grows beyond its measured release cap fails');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, isStatic: true, data: false, text: 199, controls: 3, minControls: 3,
  }), ['blank static surface'],
  'a static screen still needs enough authored content');
  assert.deepEqual(mockups.shotReadinessProblems({
    ...ready, isStatic: true, data: false, text: 745, controls: 0, minControls: 0,
  }), [], 'a configured read-only static screen passes on authored content alone');

  assert.equal(mockups.shotLooksBlank({ text: 29, nodes: 20 }, true), true);
  assert.equal(mockups.shotLooksBlank({ text: 80, nodes: 4 }, true), true);
  assert.equal(mockups.shotLooksBlank({ text: 30, nodes: 5 }, true), false);
  assert.equal(mockups.shotLooksBlank({ text: 199, nodes: 120 }, false), true);
  assert.equal(mockups.shotLooksBlank({ text: 200, nodes: 100 }, false), false);

  assert.match(source, /shotReadinessProblems\(ready\)/,
    'the generator does not use the readiness decision the guard drives');
  assert.match(source, /shotLooksBlank\(seen, !!shot\.at \|\| !!shot\.menuState\)/,
    'the generator does not use the blank-pixel decision the guard drives');
});

test('fixture families use shared card components and accessible state labels', () => {
  assert.match(source, /window\.SpeciesCards/,
    'bird fixtures exercise the real shared species card');
  assert.match(source, /window\.HotspotCards/,
    'hotspot fixtures exercise the real shared hotspot card');
  assert.match(source, /window\.ChecklistCards/,
    'checklist fixtures exercise the real shared checklist card');
  assert.match(source, /REPRESENTATIVE STUB DATA/,
    'stub content labels itself rather than resembling live data');
  assert.match(source, /NEEDED|NEW REPORT/,
    'fixture states are written in words, not encoded by colour alone');
});

test('F504-F509 release fixtures show the current Twitches and Nemesis card contract', () => {
  const speciesFixture = source.slice(
    source.indexOf('function speciesRows('),
    source.indexOf('function fillSpeciesHost('));
  assert.match(speciesFixture, /reportTags\(at === 'refreshBtn', true\)/,
    'Twitches does not show NEW, RARE, and confirmed review state inline');
  assert.match(speciesFixture, /reportTags\(false, false\)/,
    'Nemesis does not show NEW and pending review state inline');
  assert.match(speciesFixture, /spmetricstack[\s\S]*spmetric-age[\s\S]*spmetric-distance/,
    'the release fixture does not exercise the age-first two-metric stack');
  const reportTagFixture = speciesFixture.slice(
    speciesFixture.indexOf('function reportTags('),
    speciesFixture.indexOf('function stubBird('));
  assert.doesNotMatch(reportTagFixture, /RECENT/,
    'the removed RECENT tag returned to the release fixture');
});

test('F551 Mega rarity mockups exercise the current direct photo slot and controls', () => {
  assert.equal(mockups.STUB_SPEC.abaBtn.kind, 'mega-index');
  assert.deepEqual(mockups.STUB_SPEC.abaBtn.expects, [
    '#abaControls.raritycontrols > #abaViewPick.twitchviewbar',
    '#abaViewPick + #abaStatus',
    '#abaStatus + .abascoperow',
    '#abaViewPick [data-megaview="list"][aria-pressed="true"]',
    '#abaSortPick [data-abasort="date"]',
    '#abaSortPick [data-abasort="distance"]',
    '#abaResults li[data-mega-code][data-mega-view]',
    '#abaResults li[data-mega-code] .thumb',
    '#abaResults .megajump',
    '#abaResults .spmetric-age',
    '#abaResults .spmetric-distance',
  ]);
  const setup = source.slice(source.indexOf('function fillMegaIndex('),
    source.indexOf('function fillRankingHost('));
  assert.match(setup, /A\.renderAbaAlert\(/,
    'the gallery must drive the production Mega renderer, not hand-roll its rows');
  assert.doesNotMatch(setup, /setAbaScope|abaScopePick/);
  assert.match(setup, /A\.setAbaSort\('date'\)/);
  assert.match(setup,
    /A\.renderAbaAlert\(alertRows, url, true, false, meta, repaint\)/,
    'regional sort review states must repaint the same fixture without starting a fetch');
  assert.match(setup,
    /row\.obsDt = '2026-09-02 12:00'[\s\S]*row\.lat = 47\.66[\s\S]*row\.lng = -122\.12/,
    'the Nearest review needs a genuinely closer, older row so its order visibly changes');
});

test('F797 Mega fixture status updates preserve its persistent control wrapper', () => {
  const helper = source.slice(source.indexOf('function fixtureStatus('),
    source.indexOf('function markHost('));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(indexSource);
  try {
    const document = dom.window.document;
    const controls = document.getElementById('abaControls');
    const status = document.getElementById('abaStatus');
    const section = controls.closest('section');
    const button = document.getElementById('abaBtn');
    button.disabled = true;
    status.setAttribute('aria-busy', 'true');
    const update = new Function(helper + '; return fixtureStatus;')();
    update(section, 'Mega');
    assert.equal(document.getElementById('abaControls'), controls,
      'fixture status updates must preserve the production persistent wrapper');
    assert.equal(document.getElementById('abaStatus'), status);
    assert.match(status.textContent, /REPRESENTATIVE STUB DATA.*Mega/);
    assert.equal(status.hasAttribute('aria-busy'), false);
    assert.equal(button.disabled, false);

    const ordinary = document.createElement('section');
    ordinary.innerHTML = '<div class="status" hidden aria-busy="true">Loading</div>';
    update(ordinary, 'Other report');
    assert.match(ordinary.textContent, /REPRESENTATIVE STUB DATA.*Other report/);
    assert.equal(ordinary.querySelector('.status').hidden, false);
    assert.equal(ordinary.querySelector('.status').hasAttribute('aria-busy'), false);
  } finally {
    dom.window.close();
  }
  const preparation = source.slice(source.indexOf("} else if (spec.kind === 'mega-index')"),
    source.indexOf("} else if (spec.kind === 'stakeout-merged')"));
  assert.match(preparation, /await fillFixturePhotos\(host, document\)/,
    'the section capture must await its bundled photos, not just the extra shots');
});

test('Hawaii patch fallback mockups render in the Hawaii report', () => {
  assert.equal(mockups.STUB_SPEC.destBtn.report, 'hi');
  assert.equal(mockups.STUB_SPEC.excBtn.report, 'hi');
  for (const at of ['destBtn', 'excBtn']) {
    const shot = mockups.SECTION_SHOTS.find((item) => item.at === at);
    assert.ok(shot, `${at} release shot is missing`);
    assert.match(shot.prep,
      /A\.setActiveReport\(\(spec && spec\.report\) \|\| 'wa'\)/,
      `${at} paints Hawaii rows without switching the visible report`);
  }
  const rows = source.slice(source.indexOf('destBtn: ['),
    source.indexOf('excBtn: [', source.indexOf('destBtn: [')));
  assert.equal((rows.match(/^        \{ name:/gm) || []).length, 5,
    'Today’s patches review still shows fewer than the five useful Hawaii choices');
  const dayRows = source.slice(source.indexOf('excBtn: ['),
    source.indexOf('    }[at]', source.indexOf('excBtn: [')));
  assert.equal((dayRows.match(/\{ name:/g) || []).length, 3,
    'Day trip review does not show the two measured land localities plus the routed offshore trip');
  assert.match(dayRows, /North Pacific Ocean/);
  assert.match(dayRows, /round trip · special trip · boat required · fresh today/);
  assert.match(dayRows, /Pu'u O'o Trail/);
  assert.match(dayRows, /Laupahoehoe Point County Park/);
  assert.match(dayRows, /Older evidence · last report 8 days ago/);
  assert.doesNotMatch(rows, /North Pacific Ocean/,
    'the F389 named-ocean control leaked back into Today’s patches');
  const f389Review = mockups.REVIEW_SHOTS.filter((shot) =>
    /stakeout(?:reachable|distance)-f389/.test(shot.id));
  assert.equal(f389Review.length, 2,
    'Reachable and Distance no longer have paired F389 review states');
  assert.match(source, /Captain Zodiac pelagic—C/);
  assert.match(source, /subnational2Code: 'US-HI-007'/);
  assert.match(source, /Distance did not preserve all regional evidence/);
});

test('F928 outreach fixture decoration does not invent outlined bubbles', () => {
  const { JSDOM } = require('jsdom');
  const start = source.indexOf('  function ensureMockStyle(document) {');
  const end = source.indexOf('\n  function mockPhoto', start);
  assert.ok(start >= 0 && end > start);
  function checkStyle(styleSource) {
    const dom = new JSDOM('<!doctype html><head></head><body></body>');
    try {
      const apply = new Function(styleSource + '; return ensureMockStyle;')();
      apply(dom.window.document);
      const rules = [...dom.window.document.styleSheets[0].cssRules];
      for (const selector of ['.mockfixture', '.mockstate', '.mockmap']) {
        const rule = rules.find(item => item.selectorText === selector);
        assert.ok(rule, selector + ' fixture rule missing');
        assert.equal(rule.style.getPropertyValue('border'), '', selector + ' has a mockup-only border');
        assert.equal(rule.style.getPropertyValue('border-radius'), '', selector + ' has a mockup-only bubble');
      }
      assert.match(source, /REPRESENTATIVE STUB DATA/,
        'demo provenance must remain explicit after removing decoration');
    } finally {
      dom.window.close();
    }
  }
  const styleSource = source.slice(start, end);
  checkStyle(styleSource);
  for (const selector of ['.mockfixture', '.mockstate', '.mockmap']) {
    for (const declaration of ['border:2px solid black;', 'border-radius:12px;']) {
      const mutated = styleSource.replace(selector + '{', selector + '{' + declaration);
      assert.notEqual(mutated, styleSource);
      assert.throws(() => checkStyle(mutated), /mockup-only/,
        selector + ' restored decoration must fail the guard');
    }
  }
});

test('F329/F342/F345 release mockups show the completed new facts', () => {
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.match(rank, /'ebird_rankhist:' \+ historyOwner/);
  assert.match(rank, /rank:\s*170/);
  assert.match(rank, /Season best #170 · first reached Aug 20/,
    'the Top 100 release shot does not prove the earliest tied best date');

  const year = source.slice(source.indexOf("else if (at === 'myYearBody') {"),
    source.indexOf("} else if (spec.kind === 'favorites')"));
  assert.match(year, /Lewis's Woodpecker/);
  assert.match(year, /preparePersonalFixture/);
  assert.match(source, /Exact personal membership prepared · representative Year List/,
    'the My List shot must state its representative source');

  assert.match(source,
    /3 under 3h options · 1 county · all recent\/notable feeds checked/,
    'the unified Day trip release shot does not identify its selected range and completed plan');
});

test('F867 leaderboard fixture restores its synthetic profile proof before later sections', () => {
  const rank=source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("var metricButtons ="));
  assert.match(rank,/var priorIdentity=localStorage\.getItem\(A\.IDENTITY_META_KEY\)/);
  assert.match(rank,/if\(priorIdentity===null\) localStorage\.removeItem\(A\.IDENTITY_META_KEY\)/);
  assert.match(rank,/else localStorage\.setItem\(A\.IDENTITY_META_KEY,priorIdentity\)/);
  assert.ok(rank.indexOf('A.renderRankPair(')<rank.indexOf('if(priorIdentity===null)'),
    'restore only after the production renderer has consumed the temporary proof');
});

test('F868 and F870 gallery fixtures use production Ticks, F976 screenshot birds and resolved FOY taxonomy', () => {
  const ticks = source.slice(source.indexOf("else if (at === 'lastNewBtn') {"),
    source.indexOf("else if (at === 'myYearBody') {"));
  assert.match(ticks, /A\.renderLastNew\(groups,info,'US-WA',\{\}\)/);
  assert.match(ticks, /Recent birders: '\s*\+\s*tickTaxa\[index\]\.recent/);
  assert.match(ticks, /profileId:'tick-'\+index\+'-'\+i/);
  const literal = ticks.match(/\bvar tickTaxa\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(literal, 'the screenshot species must have a declared fixture contract');
  const taxa = vm.runInNewContext(literal[1]);
  assert.deepEqual(Array.from(taxa, (bird) =>
    [bird.code, bird.name, bird.recent, bird.total]), [
    ['amgplo', 'American Golden-Plover', 11, 16],
    ['laplon', 'Lapland Longspur', 10, 11],
    ['gwfgoo', 'Greater White-fronted Goose', 6, 11],
    ['sursco', 'Surf Scoter', 5, 7],
  ]);
  assert.match(ticks, /await fillFixturePhotos\(host,document\)/);
  const foy = source.slice(source.indexOf("} else if (spec.kind === 'foy') {"),
    source.indexOf("} else if (spec.kind === 'bird') {"));
  assert.match(foy, /await preparePersonalFixture/);
  assert.match(foy, /await A\.loadFoy\(\)/);
  assert.match(foy, /await fillFixturePhotos\(host, document\)/);
});

test('F856 gallery guards require visible checklist evidence and scaled 56px bird icons', () => {
  assert.match(source, /renderScale = Number\(document\.defaultView\.getComputedStyle\([\s\S]*?getPropertyValue\('--s'\)\)/,
    'geometry must use the selected app profile, not the legacy renderer argument');
  const birdGen = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (at === 'rankBtn')"));
  assert.match(birdGen, /NABO x1 - 9\/1 5:50p - S388997009/);
  assert.match(birdGen, /megaChecklist\.getAttribute\('data-href'\) !== 'https:\/\/ebird\.org\/checklist\/S388997009'/);
  assert.match(birdGen, /deferPhotos: true/);
  assert.match(birdGen, /await fillFixturePhotos\(host, document\)/);
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  for (const dimension of ['width', 'height']) {
    assert.ok(rank.includes(`Math.abs(recentThumbBox.${dimension} - 56 * renderScale) > 1`),
      `gallery does not measure ${dimension} against the scaled F851 icon size`);
  }
  assert.match(rank, /compactRowLimit = 86 \+ recentThumbBox\.height - 18 \* renderScale/);
});

test('F628 Top 100 compact-height guard allows deliberate Huge-text reflow', () => {
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.match(rank, /if \(renderScale <= 1 && firstRowRect\.height > compactRowLimit\)/,
    'the normal-size compact-row ceiling still rejects intentional Huge-text wrapping');
  assert.match(source,
    /async function fixturePrepare\(at, spec, A, document, sec, renderScale\)/,
    'the fixture preparation seam does not accept the gallery text scale');
  assert.match(source,
    /FIX\.prepare\(\$\{at\}, spec, A, document, sec,[\s\S]*\$\{JSON\.stringify\(SCALE\)\}\)/,
    'the browser-side fixture does not receive the requested gallery text scale');
});

test('F686 release preparation follows compact Top 100 and owns Stakeout work', () => {
  const rank = source.slice(source.indexOf("} else if (at === 'rankBtn')"),
    source.indexOf("} else if (spec.kind === 'patches')"));
  assert.doesNotMatch(rank, /visually prominent|rank-to-content gutter/,
    'the gallery still enforces F680\'s retired dominant-rank presentation');
  assert.match(rank, /compact rank column is too wide/);
  assert.match(rank, /compact column gutter is not 10px/);

  const stakeout = source.slice(source.indexOf('async function prepareStakeoutSpts'),
    source.indexOf('async function prepareBirdFinderMerged'));
  assert.match(stakeout,
    /A\.fgCancelAll\('Starting deterministic Stakeout fixture'\)/,
    'Stakeout preparation can still queue behind unrelated startup hydration');
  assert.match(stakeout, /A\.fgProgressReset\(\)/,
    'the deterministic Stakeout fixture does not clear inherited progress state');
  assert.match(source,
    /A\.seedEbirdCache\(A\.speciesLookupPath\(region, code, A\.SP_LOOKUP_BACK\),[\s\S]*sightingRows\)/,
    'Stakeout preparation can still queue its deterministic sighting behind unrelated work');
  assert.match(stakeout, /A\.seedChecklistView\(row\.subId, detail\)/,
    'Stakeout checklist hydration can still queue behind unrelated foreground work');
  assert.match(source,
    /prepTimeoutMs: item\.at === 'spLookupBtn' \? 45000 : undefined/,
    'the mandatory Stakeout capture still uses the generic 15-second preparation budget');
  assert.match(source,
    /id: 'stakeoutdetail'[\s\S]*?prepTimeoutMs: 45000/,
    'the detailed Stakeout capture still uses the generic 15-second preparation budget');
});

test('F384/F385 release mockups expose row actions and regional watch scope', () => {
  const year = source.slice(source.indexOf("else if (at === 'myYearBody') {"),
    source.indexOf("} else if (spec.kind === 'favorites')"));
  assert.match(year, /A\.updateMyYear\(\)/,
    'My List must use production rendering, not invented card fields');
  assert.match(year, /\.yrnum/);
  assert.match(year, /\.myYearWatchlist\[aria-pressed="false"\]/);
  assert.match(year, /\.myYearWatchlist\[aria-pressed="true"\]/,
    'the My Ticks release fixture does not show both watchlist states');

  const scope = source.slice(source.indexOf("if (at === 'nvResults')"),
    source.indexOf("} else {", source.indexOf("if (at === 'nvResults')")));
  assert.match(scope, /code: 'baisan'/);
  assert.match(scope, /code: 'hawama'/,
    'the Needs proof release fixture lost its preserved cross-region control');
  assert.match(scope, /scopeButtons\.length !== 1/);
  assert.match(scope, /scopeLabel\.textContent\.trim\(\) !== 'Region'/);
  assert.match(scope, /scopeButtons\[0\]\.getAttribute\('aria-pressed'\) !== 'true'/);
  assert.match(scope, /\/Hawaii Amakihi\/\.test\(host\.textContent\)/,
    'the release fixture does not reject a cross-region bird leaking into the default view');
  assert.match(scope, /1 of 2 species awaiting verification/,
    'the default Needs proof screenshot no longer discloses its hidden stored row');
  assert.deepEqual(mockups.STUB_SPEC.nvResults.allowDisabled, [],
    'Watch list no longer contains reorder controls');
});

test('F839 a captured but unreadable shot still fails the gallery run', () => {
  const {mockupRunPassed} = require('../assets/mockups');
  assert.equal(mockupRunPassed(1, 1, []), true);
  assert.equal(mockupRunPassed(1, 1, ['internal card readability']), false);
  assert.equal(mockupRunPassed(0, 1, []), false);
});

test('F372 review mockups prove empty Hawaii stays empty on both reported surfaces', () => {
  const birdGen = mockups.REVIEW_SHOTS.find((item) => item.id === 'hawaiiemptybirdgen');
  const ticks = mockups.REVIEW_SHOTS.find((item) => item.id === 'hawaiiemptyticks');
  assert.ok(birdGen, 'the empty-Hawaii Bird Gen review shot is missing');
  assert.ok(ticks, 'the empty-Hawaii My Ticks review shot is missing');
  assert.match(birdGen.prep, /A\.setActiveReport\('hi'\)/);
  assert.match(birdGen.prep, /dataset\.surgeSeen !== 'unseen'/);
  assert.match(birdGen.prep, /spotted\.hidden/);
  assert.match(ticks.prep, /A\.setActiveReport\('hi'\)/);
  assert.match(ticks.prep, /0 species in 2026/);
  assert.match(ticks.prep, /species logged/);
});

test('F373 review mockup proves ABA My Ticks uses the account year list', () => {
  const ticks = mockups.REVIEW_SHOTS.find((item) => item.id === 'abayearrefresh');
  assert.ok(ticks, 'the refreshed ABA My Ticks review shot is missing');
  assert.match(ticks.prep, /A\.setActiveReport\('aba'\)/);
  assert.match(ticks.prep, /ebird_own_seen:aba/);
  assert.match(ticks.prep, /ABA year-list refresh complete/);
  assert.match(ticks.prep, /no county scan/);
  assert.match(ticks.prep, /Ruby-throated Hummingbird/);
});

test('fixture photos use the extension of the bundled icon they render', () => {
  assert.equal(mockups.fixtureIconPath('semsan'), 'assets/birds/semsan.png',
    'Semipalmated Sandpiper is a PNG and must not render a broken JPG');
  assert.equal(mockups.fixtureIconPath('wessan'), 'assets/birds/wessan.jpg',
    'JPG fixtures keep their existing bundled source');
  assert.throws(() => mockups.fixtureIconPath('not-a-real-bird'),
    /no bundled fixture icon for not-a-real-bird/,
    'a missing fixture asset fails the generator instead of producing a broken image');
  assert.match(source, /fixtureIconPath\(code, BIRD_ICON_EXT\)/,
    'the browser fixture must use the same extension-aware resolver the test drives');
});

test('F920 fixture photos preserve an in-flight production request for the same bundled icon', () => {
  const image = {
    classList: { contains: () => false },
    currentSrc: '',
    src: 'https://mockup.test/assets/birds/ruff.jpg',
  };
  assert.equal(mockups.fixtureImageNeedsRefresh(
    image, 'assets/birds/ruff.jpg', 'https://mockup.test/index.html'), false,
  'matching source stays untouched even before the browser reports loaded dimensions');
  assert.equal(mockups.fixtureImageNeedsRefresh(
    image, 'assets/birds/baisan.jpg', 'https://mockup.test/index.html'), true,
  'a different bird source must be set');
  assert.equal(mockups.fixtureImageNeedsRefresh(
    { ...image, classList: { contains: (name) => name === 'isfallback' } },
    'assets/birds/ruff.jpg', 'https://mockup.test/index.html'), true,
  'a loaded fallback icon is not accepted as the requested bird photo');

  const fill = source.slice(source.indexOf('async function fillFixturePhotos('),
    source.indexOf('async function prepareTwitches(',
      source.indexOf('async function fillFixturePhotos(')));
  assert.match(fill, /fixtureImageNeedsRefresh\(img, source, document\.baseURI\)/);
  assert.match(fill, /if \(needsSource\) img\.src = await fixturePhotoSource\(source\)/);
  assert.match(fill, /await decodeFixtureImage\(img, source, fixturePhotoSource\)/);
});

test('F920 fixture image decode retries once but still requires decoded pixels', async () => {
  let attempts = 0;
  let source = '';
  const recovered = {
    naturalWidth: 0,
    decode: async () => {
      attempts++;
      if (attempts === 1) throw new Error('transient request failure');
      recovered.naturalWidth = 240;
    },
  };
  Object.defineProperty(recovered, 'src', {
    get: () => source,
    set: (value) => { source = value; },
  });

  await mockups.decodeFixtureImage(recovered, 'assets/birds/ruff.jpg');
  assert.equal(attempts, 2);
  assert.equal(source, 'assets/birds/ruff.jpg?fixture-retry=1');
  assert.equal(recovered.naturalWidth, 240);

  let emptyAttempts = 0;
  const empty = {
    naturalWidth: 0,
    src: '',
    decode: async () => { emptyAttempts++; },
  };
  await assert.rejects(
    mockups.decodeFixtureImage(empty, 'assets/birds/baisan.jpg'),
    /initial decode failed .* bounded retry failed .* zero natural width/
  );
  assert.equal(emptyAttempts, 2, 'a second zero-width result must remain a fixture failure');
});

test('F1273 fixture photo ownership survives a late production-slot callback', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="host"><span class="thumb" data-code="ruff"><img src="assets/birds/ruff.jpg"></span></div>');
  try {
    const document = dom.window.document;
    const original = document.querySelector('.thumb'), pending = original.firstChild;
    const owned = mockups.isolateFixturePhotoSlot(original);
    const photo = document.createElement('img');
    photo.src = 'assets/birds/ruff.jpg';
    owned.appendChild(photo);
    await Promise.resolve().then(() => {
      original.replaceChildren(document.createElement('img'));
    });
    assert.equal(document.querySelector('#host img'), photo,
      'late renderer completion cannot replace the visible fixture photo');
    assert.equal(pending.getAttribute('src'), 'assets/birds/ruff.jpg');
    assert.equal(owned.dataset.code, 'ruff');
    const fill = source.slice(source.indexOf('async function fillFixturePhotos('),
      source.indexOf('async function prepareTwitches(', source.indexOf('async function fillFixturePhotos(')));
    assert.match(fill, /slot = isolateFixturePhotoSlot\(slot\)/);
  } finally { dom.window.close(); }
});

test('Washington mock data follows the owner-provided September 2 seen snapshot', () => {
  assert.equal(waSeen.region, 'US-WA');
  assert.equal(waSeen.asOf, '2026-09-02');
  assert.equal(waSeen.speciesObserved, 215);
  const byCode = Object.fromEntries(waSeen.birds.map((bird) => [bird.code, bird]));
  for (const code of ['baisan', 'ruff', 'sposan', 'solsan', 'wessan']) {
    assert.equal(byCode[code].seen, true, `${code} was already on the supplied list`);
  }
  for (const code of ['nazboo1', 'shtsan', 'semsan', 'norwat', 'whiwag']) {
    assert.equal(byCode[code].seen, false, `${code} was absent from the supplied list`);
  }
  assert.equal(byCode.corplo.alpha, 'CRPL',
    'Common Ringed Plover uses the eBird taxonomy code, not the invalid coripl fixture');
  assert.ok(!byCode.coripl);
  assert.match(source, /wa-seen-2026-stub\.json/,
    'the release gallery stopped reading the sanitized seen snapshot');
  assert.match(alertSource, /wa-seen-2026-stub\.json/,
    'the dedicated Bird Gen mock stopped sharing the same seen snapshot');
  assert.doesNotMatch(source, /length:\s*209/,
    'the header count is still the obsolete invented total');
  assert.match(source, /Object\.defineProperty\(window, '__SEED_BIRDLIST__'/,
    'the fixture is not injected through the seed object production actually reads');
  assert.match(source, /ebird_seen_meta[\s\S]*source:\s*'seed'/,
    'release mockups must explicitly opt into sample data now that clean installs stay empty');
  assert.match(source, /Washington seen fixture did not reach getReportSeen/,
    'the renderer never behaviorally verifies seen/unseen state');
});

test('Bird Gen mockups use the measured September 3 alert snapshot', () => {
  const setup = source.slice(source.indexOf("if (at === 'surgeBtn')"),
    source.indexOf('\n  function wait(', source.indexOf("if (at === 'surgeBtn')")));
  const paint = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (at === 'rankBtn')"));
  for (const fact of [
    'nazboo1', 'Smith Island', 'S388997009', '2026-08-25 15:00',
    'ruff', 'Hoquiam STP', 'S387782679',
  ]) {
    assert.ok(setup.includes(fact), `Bird Gen setup lost measured fact ${fact}`);
  }
  for (const fact of [
    'amgplo', 'Tulalip Bay', 'S389016661',
    'L802523', 'vesspa', 'Jefferson Park, Seattle', 'S389010339', 'L14245785',
  ]) {
    assert.ok(paint.includes(fact), `Bird Gen paint lost measured fact ${fact}`);
  }
  assert.doesNotMatch(paint, /wessan|Western Sandpiper/,
    'the current Bird Gen shot still uses the superseded invented rows');
  assert.match(alertSource, /NABO\/nazboo1|fixtureBird\('nazboo1'\)/,
    'the dedicated review mock lost the corrected NABO identifier');
  assert.match(alertSource, /fixtureBird\('amgplo'\)[\s\S]*fixtureBird\('vesspa'\)/,
    'the dedicated review mock does not include both current unseen birds');
  assert.match(source, /class MockDate extends RealDate/,
    'fixed alert dates still age against the wall clock');
  assert.match(source, /Date\.now\(\) !== MOCK_NOW/,
    'the renderer never verifies that its fixed dates use the frozen clock');
  const main = source.indexOf('async function main()');
  assert.ok(main >= 0, 'the renderer entry point is present');
  const timezone = source.indexOf('Emulation.setTimezoneOverride', main);
  const navigate = source.indexOf('await navigateMockupFrame(', main);
  assert.ok(timezone >= 0 && navigate > timezone,
    'the browser timezone is not pinned before the mockup page loads');
  assert.match(source, /timezoneId:\s*'America\/Los_Angeles'/,
    'the release fixture no longer renders in the Washington timezone');
  assert.match(source, /Bird Gen fixture age drifted[\s\S]{0,120}24hr ago/,
    'the release renderer does not behaviorally guard its approved relative age');
  assert.match(source, /visibleCodes\.join\(','\) !== 'comter,baisan,nazboo1,amgplo,vesspa,ruff'/,
    'the release gate does not assert its exact visible Bird Gen species');
  assert.match(source, /\|\| hiddenCodes\.length/,
    'the release gate no longer proves that Bird Gen hides no species');
});

test('F302/F954 Bird Gen mockup retains facts in on-demand category evidence', () => {
  const paint = source.slice(source.indexOf("if (spec.kind === 'birdgen')"),
    source.indexOf("} else if (spec.kind === 'spuh')"));
  for (const fact of [
    'comter', 'Common Tern', 'NABO x1 - 9/1 5:50p',
    'An unseen ABA Code 3+ is within a day trip!',
    'Cedar River mouth', 'Marymoor Park', 'high yield',
  ]) {
    assert.ok(paint.includes(fact), `F302 Bird Gen mockup lost ${fact}`);
  }
  assert.match(paint,
    /template\[data-surge-evidence\][\s\S]*evidence\.content\.querySelector\('\.surgeexplainextra > \.surgefacts'\)[\s\S]*evidence\.content\.querySelector\('\.surgeexplain > b'\)/,
    'the release fixture must verify retained facts and explanation within the evidence template');
  assert.match(paint, /Bird Gen still displays the R rare-bird marker/,
    'the release fixture does not reject the removed R marker');
  assert.match(paint, /category badge must precede the bird headline/,
    'the release fixture must pin the leading category badge before the headline');
  assert.match(paint, /bird code keeps inherited leading space/,
    'the release fixture does not pin the bird code flush-left');
  assert.match(paint, /querySelector\('#surgeFeed details'\)/,
    'the release fixture does not fail if a report drawer returns');
  assert.match(source, /visibleCodes\.join\(','\) !== 'comter,baisan,nazboo1,amgplo,vesspa,ruff'/,
    'the release gate does not assert the new Cascade row');
  assert.match(paint, /still links to All Mega rarities/,
    'the release fixture does not fail if the removed Mega link returns');
  assert.match(paint, /still links to Leader Board Ticks/,
    'the release fixture does not fail if the removed leaderboard link returns');
  assert.doesNotMatch(source, /prepareBirdGenCompact|birdgencompact/,
    'the mockup suite still carries a second Notes state that no longer exists');
});

test('F366/F369 Stakeout mockups pin the representative and presence evidence', () => {
  assert.match(source,
    /if \(A\.setSpuhRandom\) A\.setSpuhRandom\(function \(\) \{ return 0; \}\);/,
    'release mockups leave the random spuh representative nondeterministic');
  const start = source.indexOf(
    'async function prepareBirdSp(A, document, sec, nodeCode)');
  const end = source.indexOf('window.FIX =', start);
  const fixture = source.slice(start, end);
  assert.match(fixture,
    /var commonness = examples\.map\(function \(row\) \{\s*return \{ speciesCode: row\[0\] \};/,
    'the regional snapshot fixture still manufactures report frequencies');
  assert.match(fixture,
    /Stakeout candidate presence became a false report count/,
    'the release renderer does not reject invented candidate report counts');
});

test('fixture specs point at real hosts and maps in index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  for (const [at, spec] of Object.entries(mockups.STUB_SPEC)) {
    assert.match(html, new RegExp('id="' + spec.host + '"'),
      `${at} points at missing result host ${spec.host}`);
    if (spec.map) {
      assert.match(html, new RegExp('id="' + spec.map + '"'),
        `${at} points at missing map host ${spec.map}`);
    }
  }
  assert.match(html, /window\.__BC_MOCKUP_MODE__/,
    'the app must suppress normal autoloaders while deterministic fixtures paint');
});

test('Pro patches and Stakeout bird exercise their production component shapes', () => {
  assert.equal(mockups.STUB_SPEC.patchBtn.kind, 'patches');
  assert.deepEqual(mockups.STUB_SPEC.patchBtn.expects,
    ['#patchResults .hscard.hscard-md', '#patchResults .patchwho']);
  assert.match(source, /A\.loadChoicePatches\(\)/,
    'Pro patches must run its real loader instead of receiving a generic rank table');

  assert.equal(mockups.STUB_SPEC.spLookupBtn.kind, 'stakeout-merged');
  assert.equal(mockups.STUB_SPEC.spuhBtn, undefined,
    'the removed Spuh menu surface still owns a release fixture');
  assert.equal(mockups.STUB_SPEC.spLookupBtn.maxHostHeight, undefined,
    'the redesigned full Stakeout page is still clipped to the old hierarchy height');
  assert.equal(mockups.STUB_SPEC.spLookupBtn.host, 'sec-spLookupBtn',
    'the release capture is not anchored to the full Stakeout page');
  assert.deepEqual(mockups.STUB_SPEC.spLookupBtn.expects, [
    '#spLookupQueryHelp:empty',
    '#spLookupResults.stakeoutSpeciesCard-details > li',
    '#spLookupResults .thumb',
    '#spLookupSortRow:not([hidden])',
    '#spLookupMap .mockmap',
    '#spLookupRecent .spLookupPlaceList > .hscard-md',
    '#spLookupRecent .stakeoutPlaceDetails .cklcard-sm',
    '#spLookupEvidenceDetails .stakeoutrarity[data-kind="mega"]',
    '#spLookupIdHelp .spuhpathsentence',
    '#spLookupIdHelp .spuhpathchip[data-spuh]',
    '#spLookupIdHelp .spuhtaxnav',
    '#spLookupIdHelp .spuhcompactpath .spuhtaxlink',
    '#spLookupIdHelp details.spuhdetails',
    '#spLookupIdHelp .spuhtaxlevel[data-rank="species"]',
  ]);
  assert.match(source, /prepareBirdFinderMerged[\s\S]*fillStakeoutSpecies/,
    'the release shot does not continue a spuh candidate into species evidence');
  assert.match(source, /candidate species cards do not fit in the result/,
    'the peep mock does not reject clipped shared species cards');
  assert.match(source,
    /spuhresulthero[\s\S]*spuhcandidatecards[\s\S]*spuhcandidatecard\[role="button"\]\[tabindex="0"\]/,
  'the peep mock does not require the medium hero and keyboard-clickable small cards');
  assert.match(indexSource,
    /\.spuhresultcard\.spuhdetailopen \.spuhresultpath\s*\{[^}]*display:\s*none/,
    'expanded Detailed view still duplicates the condensed hierarchy sentence');
  assert.doesNotMatch(indexSource,
    /\.spuhdetailopen[^{}]*\.spuhcandidatelane[^{}]*\{[^}]*display:\s*none/,
    'expanded Detailed view hides the shared regional bird list');
  assert.doesNotMatch(indexSource,
    /ToggleControls\.pressed\(\{[\s\S]*id: 'spuhViewPick'[\s\S]*label: 'Compact'/,
    'the removed Compact hierarchy control is still shipped');
  assert.match(source,
    /id: 'birdspcompact'[\s\S]*id: 'birdspdetail'/,
    'the focused review set does not render both hierarchy-view selections');
  for (const id of ['spuhcompact', 'spuhdetail', 'birdspcompact', 'birdspdetail']) {
    assert.match(source, new RegExp("id: '" + id + "'"),
      id + ' is missing from the four-state hierarchy review set');
  }
  assert.match(source,
    /assertDetailedHierarchyLayout[\s\S]*marker overlaps a label/,
    'the detailed hierarchy mock does not reject a jumbled marker/label layout');
  assert.match(source,
    /spuhhierarchyhead > h3[\s\S]*spuhhierarchyinfo[\s\S]*spuhpathalternate/,
    'the peep review does not require the heading, info control, and alternatives');
  assert.match(source,
    /spuhtaxsteps > \.spuhtaxstep\[data-rank="class"\][\s\S]*data-rank="genus"/,
    'the detailed peep review does not require every numbered backbone level');
  const birdSpFixtureStart = source.indexOf(
    'async function prepareBirdSp(A, document, sec, nodeCode)');
  const birdSpFixtureEnd = source.indexOf('window.FIX =', birdSpFixtureStart);
  assert.ok(birdSpFixtureStart >= 0 && birdSpFixtureEnd > birdSpFixtureStart,
    'the regional bird-sp fixture is missing');
  const birdSpFixture = source.slice(birdSpFixtureStart, birdSpFixtureEnd);
  assert.doesNotMatch(birdSpFixture, /fixtureStatus\(/,
    'the bird-sp review mock still prints the redundant representative-stub sentence');
  assert.match(birdSpFixture, /24 birds in its published set/,
    'the peep review does not verify the measured Calidris backbone count');
  assert.doesNotMatch(birdSpFixture,
    /comName:\s*'Charadriiformes sp\.'/,
    'the mock taxonomy invents a Charadriiformes sp. node absent from the live export');
  assert.match(source, /fillStakeoutSpecies[\s\S]*A\.lookupSpecies/,
    'the merged shot hand-rolls evidence instead of exercising the real lookup');
  assert.doesNotMatch(source, /spLookupHero|details\.spuhshell|renderSpuhStakeoutShell/,
    'the release fixture must not preserve the removed duplicate hero or collapsed shell');
  assert.match(source, /detail\.querySelector\('details\.spuhtaxdetails'\)[\s\S]*path\.open = true/,
    'the comparison shot must deliberately expand the shared Detailed view');
  assert.match(source, /detail\.querySelector\('details\.spuhcompare'\)/,
    'the comparison shot opens the control inside the expanded navigator');
  assert.match(source, /prepareStakeoutReports[\s\S]*more\.click\(\)/,
    'the focused Stakeout review shot does not exercise the real lazy append');
  const reportsStart = source.indexOf('async function prepareStakeoutReports');
  const reportsEnd = source.indexOf(
    'async function prepareBirdFinderMerged', reportsStart);
  assert.ok(reportsStart > 0 && reportsEnd > reportsStart,
    'the Stakeout reports fixture is bracketed by named functions');
  assert.match(source.slice(reportsStart, reportsEnd), /A\.fgProgressReset\(\)/,
    'the lazy-expanded Stakeout fixture leaves its app-wide loading bar visible');
  assert.match(source, /ready\.missing\.length/,
    'the capture must fail if a section-specific production shape is absent');
  assert.match(source, /Bird Gen release fixture restored the removed order controls/,
    'the exact release-device renders do not guard Buzz-only ordering');
  assert.match(source, /A\.fgProgressReset\(\)/,
    'mock-only suppressed lazy calls cannot leave a fake global loading bar in the image');
  const compareStart = source.indexOf('async function prepareCompare');
  const compareEnd = source.indexOf('async function prepareStakeoutReports', compareStart);
  const compareFixture = source.slice(compareStart, compareEnd);
  assert.match(compareFixture,
    /A\.fgCancelAll\('Mock comparison complete'\)[\s\S]*A\.fgProgressReset\(\)[\s\S]*bar\.hidden[\s\S]*mockReady = 'true'/,
    'the comparison shot declares readiness before clearing its mock-only global loading state');
  const mergedStart = source.indexOf('async function prepareBirdFinderMerged');
  const mergedEnd = source.indexOf('async function prepareBirdSp', mergedStart);
  assert.ok(mergedStart > 0 && mergedEnd > mergedStart,
    'the merged Stakeout fixture is bracketed by named functions');
  const mergedFixture = source.slice(mergedStart, mergedEnd);
  assert.match(mergedFixture, /await prepareBirdSp\(A, document, sec, 'calidr'\)/,
    'the release Stakeout state bypasses the fixture that owns regional '
    + 'species/commonness data and can wait forever on the offline fetch stub');
  assert.doesNotMatch(mergedFixture, /await A\.renderSpuhNode\('calidr'\)/,
    'the release state calls the network-dependent spuh render directly');
  assert.match(source, /function withTimeout\(promise, ms, label\)/,
    'mockup preparation has no outer deadline when an in-page promise never settles');
  assert.match(source,
    /withTimeout\(\s*c\.send\('Runtime\.evaluate'[\s\S]*shot\.id \+ ' preparation'/,
    'each CDP preparation is not bounded by the shared timeout helper');

  assert.equal(mockups.STUB_SPEC.abaBtn.kind, 'mega-index');
  assert.deepEqual(mockups.STUB_SPEC.abaBtn.expects, [
    '#abaControls.raritycontrols > #abaViewPick.twitchviewbar',
    '#abaViewPick + #abaStatus',
    '#abaStatus + .abascoperow',
    '#abaViewPick [data-megaview="list"][aria-pressed="true"]',
    '#abaSortPick [data-abasort="date"]',
    '#abaSortPick [data-abasort="distance"]',
    '#abaResults li[data-mega-code][data-mega-view]',
    '#abaResults li[data-mega-code] .thumb',
    '#abaResults .megajump',
    '#abaResults .spmetric-age',
    '#abaResults .spmetric-distance',
  ]);
  assert.match(source, /fillMegaIndex[\s\S]*A\.renderAbaAlert\(/,
    'the Mega release shot must use the production list renderer');
  for (const id of ['megalist', 'twitcheslist']) {
    const shot = mockups.EXTRA_SHOTS.find((item) => item.id === id);
    assert.ok(shot, id + ' profile comparison is absent from the release gallery');
    assert.match(shot.prep, /high-visibility/);
    assert.match(shot.prep, /\.hero/);
  }
});

test('F901 Stakeout Patch release capture includes source-labelled private checklist evidence', () => {
  const spec = mockups.STUB_SPEC.stakeHsBtn;
  const shot = mockups.SECTION_SHOTS.find((item) => item.at === 'stakeHsBtn');
  assert.ok(shot, 'the production Stakeout Patch section has no release capture');
  assert.equal(shot.fullPage, true,
    'the capped section capture omits the nearby personal checklist rows');
  assert.deepEqual(spec.requiredInCapture, [
    '#stakeHsResults .stakeHsNearbyChecklists',
    '#stakeHsResults .stakeHsNearbyChecklists .cklcard-sm[data-ev-place="Synthetic nearby personal location"]',
    '#stakeHsResults .stakeHsNearbyChecklists .privateflag',
    '#stakeHsResults .stakeHsNearbyChecklists .rareflag',
  ]);
  assert.deepEqual(shot.requiredInCapture, spec.requiredInCapture,
    'the release capture does not carry its lower-content bounds contract');

  const fixture = source.slice(
    source.indexOf("} else if (spec.kind === 'hotspot-search')"),
    source.indexOf("} else if (at === 'iconicBtn')")
  );
  assert.match(fixture, /Nearby personal locations/);
  assert.match(fixture, /data-ev-place="Synthetic nearby personal location"/);
  assert.match(fixture, /location_private:true/);
  assert.match(fixture, /kind:'Rarity'/);
  assert.match(fixture, /heading\.textContent\.trim\(\) === 'Nearby personal locations'/);
  assert.match(fixture, /nearbyRow\.querySelector\('\.privateflag'\)/);
  assert.match(fixture, /nearbyRow\.querySelector\('\.rareflag'\)/);
  assert.match(source, /expected content outside capture/,
    'readiness must fail when required nearby evidence falls below the crop');
});

test('F795 Favorite mockup guards Remove placement and its 44px hit target', () => {
  assert.deepEqual(mockups.STUB_SPEC.favResults.expects, [
    '#favMap .leaflet-marker-icon',
    '#favResults .favoritecard > .name > .ntext',
    '#favResults .favoritecard > .name > .favctl > .favdel',
    '#favResults .favoritecard > .name > .favctl + .hsdist',
  ]);
  const preparation = source.slice(
    source.indexOf("} else if (spec.kind === 'favorites')"),
    source.indexOf("} else if (spec.kind === 'hotspot-search')")
  );
  assert.match(preparation, /controls\.nextElementSibling !== distance/);
  assert.match(preparation, /DOCUMENT_POSITION_FOLLOWING/);
  assert.match(preparation, /style\.minHeight !== '44px'/);
  assert.match(preparation, /style\.paddingTop !== '0px'/);
  assert.match(preparation, /style\.paddingBottom !== '0px'/);
});

test('Stakeout checklist mockup uses the unified shared small-card list', () => {
  const shot = mockups.REVIEW_SHOTS.find(
    (item) => item.id === 'stakeoutchecklists-progressive'
  );
  assert.ok(shot);
  assert.deepEqual(shot.expects, [
    '#spLookupRecent.stakeoutChecklistMock',
    '#spLookupRecent .spLookupPlaceList .cklcard-sm',
  ]);
  assert.match(indexSource,
    /function spLookupPlaceCards[\s\S]*ChecklistCards\.list\('small', rows, 'stakeoutPlaceChecklists'\)/);
  assert.doesNotMatch(indexSource, /function megaHistoryHtml/,
    'Stakeout reintroduced the second Mega-only place list');
});

test('F642 Migration mockup exercises tonight, observed arrival, and departure lanes', () => {
  const spec = mockups.STUB_SPEC.bcBody;
  assert.equal(spec.kind, 'birdcast');
  assert.equal(spec.host, 'bcBody');
  const start = source.indexOf('function fillBirdcast');
  const end = source.indexOf('function prepareF629Nightly', start);
  assert.ok(start >= 0 && end > start, 'the merged Migration fixture exists');
  const fixture = source.slice(start, end);
  for (const fact of [
    'Common Nighthawk', 'Semipalmated Sandpiper', 'American Crow',
    'firstYearKey', 'A.migKey()', 'migrants:',
  ]) {
    assert.ok(fixture.includes(fact), `Migration mockup lost ${fact}`);
  }
  assert.match(fixture, /A\.renderBirdcast\(/,
    'the fixture must run the production merged renderer');
});

test('F642 Migration mockup seeds repeated county weeks instead of one-off noise', () => {
  const start = source.indexOf('function fillBirdcast');
  const end = source.indexOf('function prepareF629Nightly', start);
  const fixture = source.slice(start, end);
  assert.match(fixture, /2024-09-11[\s\S]*2025-09-10[\s\S]*amecro/,
    'the departure fixture lacks the repeated weeks required by the model');
  assert.match(fixture, /2024-09-18[\s\S]*2025-09-17[\s\S]*semsan/,
    'the arrival fixture lacks the repeated weeks required by the model');
});

test('F340 mockups and artifact checks run after, never inside, the IPA release path', () => {
  assert.equal(pkg.scripts.mockups, 'node assets/mockups.js',
    'the explicit local mockup command was removed');
  assert.doesNotMatch(workflow, /^\s{2}mockups:\s*$/m,
    'mockups moved back into the IPA workflow');
  const packageAt = workflow.indexOf('- name: Package .app into an unsigned .ipa');
  const verifyAt = workflow.indexOf('- name: Verify packaged IPA contents');
  const uploadAt = workflow.indexOf('- name: Upload IPA artifact');
  assert.ok(packageAt >= 0 && verifyAt > packageAt && uploadAt > verifyAt,
    'the built IPA is not contract-checked before it is uploaded');
  const preflight = workflow.slice(verifyAt, uploadAt);
  assert.match(preflight, /verify-release-bundle\.js/,
    'the pre-upload check does not run the shared bundle contract');
  assert.match(preflight, /require\('\.\/package\.json'\)\.version/,
    'the pre-upload check does not use the release-driving package version');

  const release = workflow.slice(workflow.indexOf('\n  release:'));
  assert.match(release, /^\s{4}needs:\s*\[build, gate\]\s*$/m,
    'the Release must wait for the IPA build and authoritative tests, not galleries');
  assert.doesNotMatch(release, /BirdChaser-mockups|needs:[^\r\n]*mockups/,
    'the installable Release waits for or publishes mockup artifacts');

  assert.ok(fs.existsSync(postWorkflowPath),
    'the independent post-release workflow is missing');
  assert.match(postWorkflow,
    /workflow_run:[\s\S]*workflows:\s*\["Build unsigned iOS IPA"\][\s\S]*types:\s*\[completed\]/,
    'post-release checks are not triggered after the IPA workflow completes');
  assert.match(postWorkflow,
    /workflow_run\.conclusion\s*==\s*'success'[\s\S]*workflow_run\.event\s*==\s*'push'[\s\S]*workflow_run\.head_branch\s*==\s*'main'/,
    'failed, manual, or non-main builds can publish release artifacts');
  const checkoutCount = (postWorkflow.match(/uses:\s*actions\/checkout@v4/g) || []).length;
  const exactCheckoutCount = (postWorkflow.match(
    /uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/g
  ) || []).length;
  assert.equal(checkoutCount, 3,
    'the post-release workflow should check out both jobs and the Pages branch');
  assert.equal(exactCheckoutCount, 2,
    'the production checkouts must use the exact released commit');
  assert.match(postWorkflow,
    /uses:\s*actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref:\s*gh-pages\s*\n\s*path:\s*pages-site/,
    'the browsable gallery does not preserve the existing Pages history');
  assert.match(postWorkflow,
    /check-release-tag\.js[\s\S]*workflow_run\.head_sha/,
    'the Release is not identity-checked against the triggering commit');
  assert.match(postWorkflow,
    /gh release download[\s\S]*BirdChaser-unsigned\.ipa[\s\S]*verify-release-assets\.js[\s\S]*verify-release-bundle\.js/,
    'the published IPA is not re-downloaded and checked through both contracts');
  assert.match(postWorkflow,
    /EXPECTED=.*BirdChaser-unsigned\.ipa[\s\S]*ACTUAL=.*sha256sum published\/BirdChaser-unsigned\.ipa[\s\S]*test "\$ACTUAL" = "\$EXPECTED"/,
    'the re-downloaded IPA bytes are not compared with GitHub\'s recorded digest');
  assert.match(postWorkflow,
    /^\s{2}mockups:[\s\S]*^\s{4}needs:\s*verify\s*$/m,
    'mockups do not wait for the fast post-release integrity check');
  assert.match(postWorkflow,
    /mockups\.js --width 414 --out mockups\/iphone-11[\s\S]*mockups\.js --width 402 --out mockups\/iphone-17-pro[\s\S]*mockups\.js --width 402 --scale 1\.3[\s\S]*mockups\/iphone-17-pro-large[\s\S]*mockups\.js --width 402 --scale 1\.75[\s\S]*mockups\/iphone-17-pro-max-magnification/,
    'the Standard, Large, and High visibility report galleries are not all rendered');
  assert.match(postWorkflow,
    /SHOTS\.length[\s\S]*BirdChaser-mockups\.zip[\s\S]*gh release upload[\s\S]*--clobber/,
    'the gallery count, archive, and idempotent Release attachment are incomplete');
  assert.match(postWorkflow,
    /verify-release-assets\.js[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-beta-guide\.txt,BirdChaser-mockups\.zip[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-mockups\.zip[\s\S]*BirdChaser-unsigned\.ipa,BirdChaser-beta-guide\.txt,BirdChaser-mockups\.zip/,
    'the Release inventory does not allow the beta guide while requiring the IPA and mockup ZIP');
  assert.match(postWorkflow,
    /EXPECTED_DIGEST=.*BirdChaser-mockups\.zip[\s\S]*ACTUAL_DIGEST=.*sha256sum published\/BirdChaser-mockups\.zip[\s\S]*test "\$ACTUAL_DIGEST" = "\$EXPECTED_DIGEST"/,
    'the re-downloaded gallery bytes are not compared with GitHub\'s recorded digest');
  assert.match(postWorkflow,
    /build-mockup-gallery\.js[\s\S]*--input published\/mockups\/mockups[\s\S]*--version "\$\{\{ needs\.verify\.outputs\.version \}\}"[\s\S]*git push origin HEAD:gh-pages/,
    'the digest-verified release gallery is not published as versioned browsable HTML');
  assert.doesNotMatch(postWorkflow, /continue-on-error:/,
    'the independent workflow hides its own failures instead of reporting them');
  assert.doesNotMatch(postWorkflow, /repository:\s*WyattHoutz\/birding(?:\s|$)/,
    'the public workflow tries to read private source');

  const checkStart = release.indexOf('- name: Has this version already been released?');
  const checkEnd = release.indexOf('- name: Download the IPA this run built', checkStart);
  const releaseCheck = release.slice(checkStart, checkEnd);
  assert.match(releaseCheck,
    /node assets\/check-release-tag\.js "\$\{\{ steps\.ver\.outputs\.tag \}\}" "\$GITHUB_SHA"/,
    'the fail-closed tag identity checker is not run');
  assert.doesNotMatch(releaseCheck, /gh release view/,
    'the workflow still treats every Release lookup failure as an absent Release');
  assert.match(release,
    /gh release upload[\s\S]{0,300}BirdChaser-unsigned\.ipa[\s\S]{0,100}--clobber/,
    'rerunning the tagged commit must repair the required IPA');
  assert.match(release,
    /gh release create[\s\S]{0,500}BirdChaser-unsigned\.ipa/,
    'a new Release must attach the IPA');
});

test('release state lookup fails closed except for an explicit HTTP 404', () => {
  const helperPath = path.join(ROOT, 'assets', 'check-release-tag.js');
  assert.ok(fs.existsSync(helperPath), 'the release tag decision helper is missing');
  const releaseCheck = require(helperPath);
  const fake = (results) => {
    let i = 0;
    return () => results[i++];
  };
  assert.deepEqual(releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
    { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
  ])), { tagExists: false, releaseExists: false });
  assert.deepEqual(releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
    { status: 0, stdout: 'abc\n', stderr: '' },
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
  ])), { tagExists: true, releaseExists: true, sha: 'abc' });
  assert.deepEqual(releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
    { status: 0, stdout: 'abc\n', stderr: '' },
    { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
  ])), { tagExists: true, releaseExists: false, sha: 'abc' });
  assert.throws(() => releaseCheck.checkReleaseState('v1.66.0', 'def', fake([
    { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
    { status: 0, stdout: 'abc\n', stderr: '' },
  ])), /already points to abc, not def/);
  const failures = [
    { status: 1, stdout: '', stderr: 'gh: HTTP 401: Bad credentials' },
    { status: 1, stdout: '', stderr: 'connection reset by peer' },
    { status: 1, stdout: '', stderr: 'gh: HTTP 500: server error' },
  ];
  for (const failure of failures) {
    assert.throws(() => releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([failure])),
      /Could not determine whether tag/,
      'a non-404 tag lookup failure was treated as tag absent');
    assert.throws(() => releaseCheck.checkReleaseState('v1.66.0', 'abc', fake([
      { status: 0, stdout: 'HTTP/2 200 OK', stderr: '' },
      { status: 0, stdout: 'abc\n', stderr: '' },
      failure,
    ])), /Could not determine whether Release/,
    'a non-404 Release lookup failure was treated as Release absent');
  }
  assert.match(fs.readFileSync(helperPath, 'utf8'), /GITHUB_OUTPUT/,
    'the helper does not publish its fail-closed Release decision to later workflow steps');
});
