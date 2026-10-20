const fs = require("node:fs");
const path = require("node:path");

/**
 * NativeWind pre-creates native cache files but not web.css. In non-watching CI,
 * creating web.css later leaves it outside Metro's initial file map. Match the
 * native initialization behavior so Tailwind can replace this file during export.
 *
 * @param {string} [cacheDirectory]
 */
function prepareNativeWindWebCache(cacheDirectory) {
  const directory =
    cacheDirectory ??
    path.resolve(
      path.dirname(require.resolve("react-native-css-interop/metro")),
      "../../.cache",
    );
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "web.css");
  try {
    // Exclusive creation preserves an existing stylesheet and handles concurrent initialization.
    fs.writeFileSync(file, "", { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return file;
}

module.exports = { prepareNativeWindWebCache };
