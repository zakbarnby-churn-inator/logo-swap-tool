// Runs automatically after electron-builder packages the .app, before the
// DMG gets created. Ad-hoc signs it (free, no Apple Developer account
// needed) -- this doesn't make the app "trusted" the way a paid Developer
// ID would, but it gives it *a* signature, which keeps modern macOS from
// treating it as "damaged" and blocking it outright. A right-click > Open
// is still needed the first time (normal for any unsigned/ad-hoc app),
// but at least that option exists.
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  console.log("[afterPack] ad-hoc signing:", appPath);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
};
