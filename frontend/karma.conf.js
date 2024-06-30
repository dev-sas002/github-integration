/**
 * Karma configuration.
 *
 * Explicit rather than implicit so the suite runs the same way locally and in
 * CI: a headless Chrome with the flags a container needs, a single run by
 * default, and no interactive HTML reporter (its debug context is what made
 * Karma report a spurious "full page reload" on every run).
 */
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    client: {
      jasmine: {},
      clearContext: false,
    },
    reporters: ['progress'],
    browsers: ['ChromeHeadlessCI'],
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        // Chrome cannot use its sandbox inside an unprivileged container.
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage'),
      subdir: '.',
      reporters: [{ type: 'text-summary' }],
    },
    restartOnFileChange: true,
    singleRun: true,
    autoWatch: false,
  });
};
