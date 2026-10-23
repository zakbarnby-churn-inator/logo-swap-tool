// Expects a global `params` object with:
//   templatePath, logoPath, layerName, outputDir, baseName, manifestFile
//
// Replaces the Smart Object's contents directly (Photoshop already fits new
// content into the existing box on its own -- no extra resizing needed).
// Then, if the document has artboards, exports each one as its own PNG file
// (baseName_ArtboardName.png). If there are no artboards, exports the whole
// canvas as one file (baseName.png), same as before.

function findLayerByName(layers, name) {
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.name === name) return layer;
    if (layer.typename === "LayerSet") {
      var found = findLayerByName(layer.layers, name);
      if (found) return found;
    }
  }
  return null;
}

function placeFile(filePath) {
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID("null"), new File(filePath));
  executeAction(charIDToTypeID("Plc "), desc, DialogModes.NO);
}

// Opens the master Smart Object's contents (same as double-clicking it),
// clears out whatever was inside, places the new logo, and fits/centers it
// to the EXISTING embedded canvas size. Because the canvas dimensions never
// change, the outer transform on every artboard instance is left completely
// untouched -- this mirrors manually pasting into the Smart Object, which is
// the one approach that reliably avoids any sizing drift.
function swapMasterLogo(doc, masterLayer, logoPath) {
  doc.activeLayer = masterLayer;
  executeAction(stringIDToTypeID("placedLayerEditContents"), undefined, DialogModes.NO);

  var embeddedDoc = app.activeDocument;
  var oldLayers = [];
  for (var i = 0; i < embeddedDoc.layers.length; i++) {
    oldLayers.push(embeddedDoc.layers[i]);
  }

  placeFile(logoPath);
  var newLayer = embeddedDoc.activeLayer;

  var canvasW = embeddedDoc.width.value;
  var canvasH = embeddedDoc.height.value;
  var b = newLayer.bounds;
  var curW = b[2].value - b[0].value;
  var curH = b[3].value - b[1].value;

  if (curW > 0 && curH > 0) {
    var scalePct = Math.min(canvasW / curW, canvasH / curH) * 100;
    // Apply the user's custom scale on top of the normal fit-to-box size.
    // 100% = fits the box exactly (previous default behavior).
    var customScale = (typeof params.scalePercent === "number" ? params.scalePercent : 100) / 100;
    scalePct = scalePct * customScale;
    newLayer.resize(scalePct, scalePct, AnchorPosition.MIDDLECENTER);
  }

  var nb = newLayer.bounds;
  var curCenterX = (nb[0].value + nb[2].value) / 2;
  var curCenterY = (nb[1].value + nb[3].value) / 2;
  newLayer.translate(canvasW / 2 - curCenterX, canvasH / 2 - curCenterY);

  for (var j = 0; j < oldLayers.length; j++) {
    try { oldLayers[j].remove(); } catch (eRemove) { /* already gone */ }
  }

  embeddedDoc.close(SaveOptions.SAVECHANGES);
  app.activeDocument = doc;
}

// artboardEnabled isn't exposed as a plain DOM property -- has to be read
// through Action Manager directly.
function isArtboard(layer) {
  try {
    var ref = new ActionReference();
    ref.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("artboardEnabled"));
    ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    var desc = executeActionGet(ref);
    return desc.getBoolean(stringIDToTypeID("artboardEnabled"));
  } catch (e) {
    return false;
  }
}

function exportPngDoc(doc, outputPath) {
  var pngFile = new File(outputPath);
  var opts = new ExportOptionsSaveForWeb();
  opts.format = SaveDocumentType.PNG;
  opts.PNG8 = false;
  opts.transparency = true;
  doc.exportDocument(pngFile, ExportType.SAVEFORWEB, opts);
}

// Native WebP export via Action Manager (Photoshop has no ExportOptionsWebP
// class in classic scripting) -- adapted from a known-working script, with
// the document ID read dynamically from the doc itself rather than
// hard-coded, since a fixed ID would only coincidentally match one session.
function exportWebpDoc(doc, outputPath) {
  var s2t = function (s) { return app.stringIDToTypeID(s); };
  var descriptor = new ActionDescriptor();
  var options = new ActionDescriptor();
  options.putEnumerated(s2t("compression"), s2t("WebPCompression"), s2t("compressionLossy"));
  options.putInteger(s2t("quality"), 100);
  options.putBoolean(s2t("includeXMPData"), true);
  options.putBoolean(s2t("includeEXIFData"), true);
  options.putBoolean(s2t("includePsExtras"), true);
  descriptor.putObject(s2t("as"), s2t("WebPFormat"), options);
  descriptor.putPath(s2t("in"), new File(outputPath), true);
  descriptor.putInteger(s2t("documentID"), doc.id);
  descriptor.putBoolean(s2t("lowerCase"), true);
  descriptor.putEnumerated(s2t("saveStage"), s2t("saveStageType"), s2t("saveSucceeded"));
  executeAction(s2t("save"), descriptor, DialogModes.NO);
}

// Picks the right export function/extension based on params.format ("png" or "webp").
function exportDoc(doc, outputDir, filenameNoExt) {
  if (params.format === "webp") {
    var outPath = outputDir + "/" + filenameNoExt + ".webp";
    exportWebpDoc(doc, outPath);
    return outPath;
  } else {
    var outPath2 = outputDir + "/" + filenameNoExt + ".png";
    exportPngDoc(doc, outPath2);
    return outPath2;
  }
}

function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9_\-]+/g, "_");
}

// Preview mode only: shrink the doc before export so encoding/writing is
// much faster and the resulting file is smaller/quicker to load in the UI.
// Never used for real exports -- only when params.previewMode is true.
function downscaleForPreview(doc) {
  var maxDim = 800;
  var curW = doc.width.value;
  var curH = doc.height.value;
  var longest = Math.max(curW, curH);
  if (longest > maxDim) {
    var scale = maxDim / longest;
    doc.resizeImage(curW * scale, curH * scale, doc.resolution, ResampleMethod.BICUBICSHARPER);
  }
}

(function main() {
  app.preferences.rulerUnits = Units.PIXELS;

  var doc = app.open(new File(params.templatePath));
  var masterLayer = findLayerByName(doc.layers, params.layerName);

  if (!masterLayer) {
    doc.close(SaveOptions.DONOTSAVECHANGES);
    throw new Error(
      "Could not find a layer named '" + params.layerName +
      "'. Run the scan/rename step first."
    );
  }

  swapMasterLogo(doc, masterLayer, params.logoPath);

  // Find top-level artboards.
  var artboards = [];
  for (var i = 0; i < doc.layers.length; i++) {
    var l = doc.layers[i];
    if (l.typename === "LayerSet" && isArtboard(l)) artboards.push(l);
  }

  var exportedPaths = [];

  if (artboards.length === 0) {
    if (params.previewMode) downscaleForPreview(doc);
    var outPath = exportDoc(doc, params.outputDir, params.baseName);
    exportedPaths.push(outPath);
  } else {
    for (var a = 0; a < artboards.length; a++) {
      var ab = artboards[a];
      var abName = ab.name;

      var startState = doc.activeHistoryState;
      doc.activeLayer = ab;

      // Wrap the whole artboard into a new Smart Object -- Photoshop handles
      // the geometry internally, avoiding the bounds/negative-coordinate
      // issues that a manual crop/select can run into.
      executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);

      // Open that Smart Object's contents as its own correctly-sized document.
      executeAction(stringIDToTypeID("placedLayerEditContents"), undefined, DialogModes.NO);
      var tempDoc = app.activeDocument;

      // The embedded doc wraps everything in one group -- ungroup, then trim
      // any transparent padding left over from the wrapping.
      try {
        tempDoc.selection.selectAll();
        var ungroupDesc = new ActionDescriptor();
        var ungroupRef = new ActionReference();
        ungroupRef.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        ungroupDesc.putReference(charIDToTypeID("null"), ungroupRef);
        executeAction(stringIDToTypeID("ungroupLayersEvent"), ungroupDesc, DialogModes.NO);
      } catch (eUngroup) {
        // fine if there was nothing to ungroup
      }

      var trimDesc = new ActionDescriptor();
      trimDesc.putBoolean(charIDToTypeID("Dlt "), true);
      executeAction(charIDToTypeID("Crop"), trimDesc, DialogModes.NO);

      if (params.previewMode) downscaleForPreview(tempDoc);

      var outPath = exportDoc(tempDoc, params.outputDir, params.baseName + "_" + sanitizeName(abName));
      exportedPaths.push(outPath);

      tempDoc.close(SaveOptions.DONOTSAVECHANGES);

      // Revert the main doc back to before we added the temporary placed
      // layer, so the next artboard isn't affected by leftover changes.
      app.activeDocument = doc;
      doc.activeHistoryState = startState;
    }
  }

  var manifestFile = new File(params.manifestFile);
  if (manifestFile.exists) manifestFile.remove();
  manifestFile.open("w");
  manifestFile.write(exportedPaths.join("\n"));
  manifestFile.close();

  // Close WITHOUT saving so the original template file stays a clean, reusable template.
  doc.close(SaveOptions.DONOTSAVECHANGES);
})();
