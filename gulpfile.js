/* eslint-disable no-console */
const { series, parallel } = require('gulp');
const exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const glob = require('glob');
const run = require('gulp-run-command').default;
const path = require('path');

function runCommand(cb, cmd) {
  exec(cmd, function (err, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
    cb(err);
  });
}

function runCommand2(done, cmd, workDir) {
  run(cmd, {
    cwd: workDir
  })().then(done);
}

function buildBackend(cb) {
  runCommand(cb, 'npm run build');
}

function buildFrontend(cb) {
  runCommand(cb, 'cd frontend && npm run build');
}

function testBackend(cb) {
  runCommand(cb, 'npm run test');
}

function testFrontend(cb) {
  runCommand(cb, 'cd frontend && npm run test');
}

function lintBackend(cb) {
  runCommand(cb, 'npm run lint');
}

function lintFrontend(cb) {
  runCommand(cb, 'cd frontend && npm run lint');
}

function e2eBackend(cb) {
  runCommand(cb, 'npm run test:e2e');
}

function e2eFrontend(cb) {
  runCommand2(cb, 'npm run test:e2e', 'frontend');
}

function installBackend(cb) {
  runCommand(cb, 'npm install');
}

function preInstallBackend(cb) {
  runCommand(cb, 'npm install gulp-run-command')
}

function installFrontend(cb) {
  runCommand2(cb, 'npm install', 'frontend');
}

function installFrontendWebdriver(cb) {
  runCommand2(cb, 'npm install --force --production webdriver-manager@latest', 'frontend/node_modules/protractor');
}

function updateFrontendWebdriver(cb) {
  // Set the CHROMEDRIVER_VERSION environment variable to the chromedriver version that
  // fits the installed chrome version. Not setting the variable will use the latest
  // chromedriver. Note: you'll have to specify the full version number, e.g. 77.0.3865.40
  // which can be found on https://chromedriver.storage.googleapis.com/.
  var installedVersion;
  if (process.env.OS === 'Windows_NT') {
    console.log('Building on Windows');
    glob.sync('C:\\Program Files (x86)\\Google\\Chrome\\Application\\[0-9]*').forEach(function (file) {
      installedVersion = path.basename(file);
    });
  } else if (process.env.DESKTOP_SESSION === 'ubuntu' || (process.env.ImageOS && process.env.ImageOS.startsWith('ubuntu'))) {
    console.log('Building on Ubuntu');
    // ImageOS and CHROMEWEBDRIVER are set when building with GitHub actions
    if (process.env.CHROMEWEBDRIVER) {
      installedVersion = execSync(
        `${process.env.CHROMEWEBDRIVER}/chromedriver --version | cut -d " " -f 2`,
      );
    } else {
      installedVersion = execSync(
        'grep "readonly UPSTREAM_VERSION" /usr/bin/chromium-browser | cut -d "=" -f 2',
      );
    }
  } else {
    console.log('Building on Mac');
    glob.sync(
        '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/[0-9]*',
      )
      .sort()
      .forEach(function (file) {
        installedVersion = path.basename(file);
      });
  }

  if (installedVersion == null) {
    installedVersion = 'latest';
  }
  console.log('Detected installed Chrome version as ' + installedVersion);

  const driverVersion = process.env.CHROMEDRIVER_VERSION ? process.env.CHROMEDRIVER_VERSION : installedVersion;

  console.log('Updating Chromedriver to ' + driverVersion);

  runCommand2(cb, `node_modules/.bin/webdriver-manager update --versions.chrome ${driverVersion}`,
    'frontend/node_modules/protractor');
}

function installBackendCi(cb) {
  runCommand(cb, 'npm ci');
}

function installFrontendCi(cb) {
  runCommand2(cb, 'npm ci', 'frontend');
}

function deployBackend(cb) {
  runCommand(cb, 'npm run prestart:prod')
}

function deployFrontend(cb) {
  runCommand2(cb, 'npm run build:prod', 'frontend')
}

exports.default = series(
  parallel(installBackend,
    series(installFrontend, installFrontendWebdriver, updateFrontendWebdriver)),
  parallel(lintBackend, lintFrontend),
  parallel(testBackend, testFrontend),
  parallel(e2eBackend, e2eFrontend))
exports.build = series(buildBackend, buildFrontend)
exports.test = series(testBackend, testFrontend)
exports.lint = series(lintBackend, lintFrontend)
exports.e2e = series(e2eBackend, e2eFrontend)
exports.e2eBackend = series(e2eBackend)
exports.install = series(installBackend, installFrontend)
exports.installCi = series(installBackendCi, installFrontendCi)
exports.cibuild = series(
  preInstallBackend,
  parallel(installBackendCi,
    series(installFrontendCi, installFrontendWebdriver, updateFrontendWebdriver)),
  parallel(lintBackend, lintFrontend))
exports.citest = series(
  parallel(testBackend, testFrontend),
  parallel(e2eBackend, e2eFrontend))
exports.deploy = series(deployFrontend, deployBackend)
