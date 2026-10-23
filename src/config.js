// Adjust these to match the exact app names installed on your Mac.
// You can check the exact name by looking in /Applications — e.g.
// "Adobe Photoshop 2025", "Adobe Illustrator 2025", etc.
module.exports = {
  PHOTOSHOP_APP_NAME: "Adobe Photoshop 2025",
  ILLUSTRATOR_APP_NAME: "Adobe Illustrator 2025",

  // The name every logo Smart Object (Photoshop) or placed item (Illustrator)
  // should be renamed to during the cleanup/scan pass.
  // If a template has multiple logo slots, use LOGO_1, LOGO_2, etc.
  DEFAULT_LOGO_LAYER_NAME: "LOGO",

  // Where temp param files get written for the JSX scripts to read
  TEMP_DIR: "/tmp/logo-swap-tool"
};
