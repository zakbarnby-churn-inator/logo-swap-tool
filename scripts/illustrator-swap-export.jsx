// Expects a global `params` object with: templatePath, logoPath, layerName, outputPng
//
// Approach: rather than relying on Illustrator's default Relink behavior (which can
// stretch a new asset to match the old bounding box if aspect ratios differ), this
// script measures the old logo's box, deletes it, places the new logo fresh (so we
// get its true native aspect ratio), scales it to CONTAIN-fit inside the original
// box (no distortion), and centers it in the same spot. This also means it works
// whether the old logo was a Placed file OR leftover pasted/grouped artwork.

function findItemByName(doc, name) {
  for (var i = 0; i < doc.pageItems.length; i++) {
    if (doc.pageItems[i].name === name) return doc.pageItems[i];
  }
  return null;
}

function boundsInfo(geometricBounds) {
  // geometricBounds = [left, top, right, bottom] in points, y-up (top > bottom)
  var left = geometricBounds[0], top = geometricBounds[1],
      right = geometricBounds[2], bottom = geometricBounds[3];
  return {
    width: right - left,
    height: top - bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function exportPng(doc, outputPath) {
  var pngFile = new File(outputPath);
  var opts = new ExportOptionsPNG24();
  opts.transparency = true;
  opts.artBoardClipping = true;
  opts.antiAliasing = true;
  if (params.previewMode) {
    opts.horizontalScale = 40;
    opts.verticalScale = 40;
  }
  doc.exportFile(pngFile, ExportType.PNG24, opts);
}

(function main() {
  var doc = app.open(new File(params.templatePath));
  var oldItem = findItemByName(doc, params.layerName);

  if (!oldItem) {
    doc.close(SaveOptions.DONOTSAVECHANGES);
    throw new Error(
      "Could not find an item named '" + params.layerName +
      "'. Run the scan/rename step first to standardize this template's logo item name."
    );
  }

  var targetBox = boundsInfo(oldItem.geometricBounds);
  var parentLayer = oldItem.layer;
  var itemName = oldItem.name;

  oldItem.remove();

  // Place the new logo fresh so we get its true native size/aspect ratio.
  var newItem = doc.placedItems.add();
  newItem.file = new File(params.logoPath);
  newItem.move(parentLayer, ElementPlacement.PLACEATBEGINNING);

  var nativeBox = boundsInfo(newItem.geometricBounds);
  if (nativeBox.width > 0 && nativeBox.height > 0) {
    var scalePct = Math.min(targetBox.width / nativeBox.width, targetBox.height / nativeBox.height) * 100;
    // Apply the user's custom scale on top of the normal fit-to-box size.
    // 100% = fits the box exactly (previous default behavior).
    var customScale = (typeof params.scalePercent === "number" ? params.scalePercent : 100) / 100;
    scalePct = scalePct * customScale;
    newItem.resize(scalePct, scalePct, true, true, true, true, scalePct, Transformation.CENTER);
  }

  var currentBox = boundsInfo(newItem.geometricBounds);
  newItem.translate(targetBox.centerX - currentBox.centerX, targetBox.centerY - currentBox.centerY);

  // Restore the original slot name so future scans/reruns still find this item.
  newItem.name = itemName;

  exportPng(doc, params.outputPng);

  // Close WITHOUT saving so the original template file stays a clean, reusable template.
  doc.close(SaveOptions.DONOTSAVECHANGES);
})();
