// Expects a global `params` object with: templatePath, resultFile
// (loaded via $.evalFile before this script runs)

function collectSmartObjectNames(layers, out) {
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.typename === "LayerSet") {
      collectSmartObjectNames(layer.layers, out);
    } else if (layer.kind === LayerKind.SMARTOBJECT) {
      out.push(layer.name);
    }
  }
}

function toJsonStringArray(arr) {
  var parts = [];
  for (var i = 0; i < arr.length; i++) {
    var escaped = String(arr[i]).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    parts.push('"' + escaped + '"');
  }
  return "[" + parts.join(",") + "]";
}

(function main() {
  var doc = app.open(new File(params.templatePath));
  var names = [];
  collectSmartObjectNames(doc.layers, names);

  var resultFile = new File(params.resultFile);
  resultFile.open("w");
  resultFile.write('{"layers":' + toJsonStringArray(names) + '}');
  resultFile.close();

  doc.close(SaveOptions.DONOTSAVECHANGES);
})();
