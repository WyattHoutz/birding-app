'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE_REF = 'BCF388000000000000000001';
const BUILD_REF = 'BCF388000000000000000002';

function replaceOnce(text, needle, replacement, label) {
  const first = text.indexOf(needle);
  if (first < 0 || text.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Expected exactly one ${label}`);
  }
  return text.slice(0, first) + replacement + text.slice(first + needle.length);
}

function plistArrayValue(text, key, value) {
  const marker = `<key>${key}</key>`;
  if (!text.includes(marker)) {
    return replaceOnce(text, '</dict>\n</plist>',
      `\t${marker}\n\t<array><string>${value}</string></array>\n</dict>\n</plist>`,
      'root Info.plist dictionary end');
  }
  const expression = new RegExp(`(<key>${key}</key>\\s*<array>)([\\s\\S]*?)(</array>)`, 'g');
  const matches = Array.from(text.matchAll(expression));
  if (matches.length !== 1) throw new Error(`Expected exactly one Info.plist ${key} array`);
  if (matches[0][2].includes(`<string>${value}</string>`)) return text;
  return text.replace(expression, (_, open, body, close) =>
    `${open}${body}\n\t\t<string>${value}</string>\n\t${close}`);
}

function install(repoRoot) {
  const root = path.resolve(repoRoot || path.join(__dirname, '..', '..'));
  const source = path.join(root, 'native', 'ios', 'ViewController.swift');
  const appDir = path.join(root, 'ios', 'App', 'App');
  const destination = path.join(appDir, 'ViewController.swift');
  const projectPath = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const storyboardPath = path.join(appDir, 'Base.lproj', 'Main.storyboard');
  const notificationSource = path.join(root, 'native', 'ios', 'BirdGenNotifications.swift');
  const delegatePath = path.join(appDir, 'AppDelegate.swift');
  const plistPath = path.join(appDir, 'Info.plist');

  for (const required of [source, notificationSource, projectPath, storyboardPath, delegatePath, plistPath]) {
    if (!fs.existsSync(required)) throw new Error(`Missing required iOS file: ${required}`);
  }
  fs.copyFileSync(source, destination);
  fs.copyFileSync(notificationSource, path.join(appDir, 'BirdGenNotifications.swift'));

  let project = fs.readFileSync(projectPath, 'utf8').replace(/\r\n/g, '\n');
  if (!project.includes(`${FILE_REF} /* ViewController.swift */`)) {
    project = replaceOnce(
      project,
      '/* End PBXBuildFile section */',
      `\t\t${BUILD_REF} /* ViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF} /* ViewController.swift */; };\n/* End PBXBuildFile section */`,
      'PBXBuildFile section end');
    project = replaceOnce(
      project,
      '/* End PBXFileReference section */',
      `\t\t${FILE_REF} /* ViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ViewController.swift; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
      'PBXFileReference section end');
    project = replaceOnce(
      project,
      '\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,\n',
      `\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\t${FILE_REF} /* ViewController.swift */,\n`,
      'AppDelegate file in the App group');
    project = replaceOnce(
      project,
      '\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n',
      `\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n\t\t\t\t${BUILD_REF} /* ViewController.swift in Sources */,\n`,
      'AppDelegate build entry in Sources');
  }
  const sourcesPhase = /\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//
    .exec(project);
  if (!sourcesPhase ||
      !sourcesPhase[1].includes(`${BUILD_REF} /* ViewController.swift in Sources */`)) {
    throw new Error('ViewController.swift was not added to the App Sources phase');
  }
  const notificationFile = 'BCF979000000000000000001';
  const notificationBuild = 'BCF979000000000000000002';
  if (!project.includes(`${notificationFile} /* BirdGenNotifications.swift */`)) {
    project = replaceOnce(project, '/* End PBXBuildFile section */',
      `\t\t${notificationBuild} /* BirdGenNotifications.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${notificationFile} /* BirdGenNotifications.swift */; };\n/* End PBXBuildFile section */`,
      'notification PBXBuildFile section end');
    project = replaceOnce(project, '/* End PBXFileReference section */',
      `\t\t${notificationFile} /* BirdGenNotifications.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = BirdGenNotifications.swift; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
      'notification PBXFileReference section end');
    project = replaceOnce(project, `\t\t\t\t${FILE_REF} /* ViewController.swift */,\n`,
      `\t\t\t\t${FILE_REF} /* ViewController.swift */,\n\t\t\t\t${notificationFile} /* BirdGenNotifications.swift */,\n`,
      'notification App group entry');
    project = replaceOnce(project, `\t\t\t\t${BUILD_REF} /* ViewController.swift in Sources */,\n`,
      `\t\t\t\t${BUILD_REF} /* ViewController.swift in Sources */,\n\t\t\t\t${notificationBuild} /* BirdGenNotifications.swift in Sources */,\n`,
      'notification App Sources entry');
  }
  const notificationSources = /\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//.exec(project);
  if (!notificationSources || !notificationSources[1].includes(`${notificationBuild} /* BirdGenNotifications.swift in Sources */`)) {
    throw new Error('BirdGenNotifications.swift was not added to the App Sources phase');
  }
  fs.writeFileSync(projectPath, project);

  let storyboard = fs.readFileSync(storyboardPath, 'utf8');
  const capacitorController =
    'customClass="CAPBridgeViewController" customModule="Capacitor"';
  const appController =
    'customClass="ViewController" customModule="App" customModuleProvider="target"';
  if (storyboard.includes(capacitorController)) {
    storyboard = replaceOnce(
      storyboard, capacitorController, appController, 'Capacitor storyboard controller');
  }
  if (!storyboard.includes(appController)) {
    throw new Error('Main.storyboard does not instantiate the FullReport ViewController');
  }
  fs.writeFileSync(storyboardPath, storyboard);

  let delegate = fs.readFileSync(delegatePath, 'utf8').replace(/\r\n/g, '\n');
  const launch = /(func application\(_ application: UIApplication, didFinishLaunchingWithOptions[\s\S]*?-> Bool \{)([\s\S]*?)(\n    \})/g;
  const launches = Array.from(delegate.matchAll(launch));
  if (launches.length !== 1) throw new Error('Expected exactly one AppDelegate launch handler');
  if (!launches[0][2].includes('BirdGenNotificationService.install()')) {
    delegate = delegate.replace(launch, (_, open, body, close) =>
      `${open}\n        BirdGenNotificationService.install()${body}${close}`);
  }
  fs.writeFileSync(delegatePath, delegate);
  const identifier = /static let taskIdentifier = "([A-Za-z0-9.-]+)"/
    .exec(fs.readFileSync(notificationSource, 'utf8'));
  if (!identifier) throw new Error('The native background task identifier is missing');
  let plist = fs.readFileSync(plistPath, 'utf8').replace(/\r\n/g, '\n');
  plist = plistArrayValue(plist, 'BGTaskSchedulerPermittedIdentifiers', identifier[1]);
  plist = plistArrayValue(plist, 'UIBackgroundModes', 'fetch');
  fs.writeFileSync(plistPath, plist);
}

if (require.main === module) {
  install(process.argv[2]);
}

module.exports = { install };
