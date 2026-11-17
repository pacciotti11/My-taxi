// Extends app.json with values that change per build. CI sets
// ANDROID_VERSION_CODE to the workflow run number so each APK installs as an
// update over the previous one.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
  },
});
