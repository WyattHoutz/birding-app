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

function install(repoRoot) {
  const root = path.resolve(repoRoot || path.join(__dirname, '..', '..'));
  const source = path.join(root, 'native', 'ios', 'ViewController.swift');
  const appDir = path.join(root, 'ios', 'App', 'App');
  const destination = path.join(appDir, 'ViewController.swift');
  const projectPath = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const storyboardPath = path.join(appDir, 'Base.lproj', 'Main.storyboard');

  for (const required of [source, projectPath, storyboardPath]) {
    if (!fs.existsSync(required)) throw new Error(`Missing required iOS file: ${required}`);
  }
  fs.copyFileSync(source, destination);

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
}

if (require.main === module) {
  install(process.argv[2]);
}

module.exports = { install };
