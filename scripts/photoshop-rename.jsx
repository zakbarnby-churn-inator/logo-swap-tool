// Expects a global `params` object with: templatePath, currentName, newName

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

(function main() {
  var doc = app.open(new File(params.templatePath));
  var layer = findLayerByName(doc.layers, params.currentName);
  if (!layer) {
    doc.close(SaveOptions.DONOTSAVECHANGES);
    throw new Error("Layer not found: " + params.currentName);
  }
  layer.name = params.newName;
  doc.close(SaveOptions.SAVECHANGES);
})();
