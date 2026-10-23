// Expects a global `params` object with: templatePath, resultFile
// Lists every top-level-ish page item (Placed files, Groups from pasted SVGs, etc.)
// so you can identify which one is the logo slot, even if it has no name yet.

function escapeStr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

(function main() {
  var doc = app.open(new File(params.templatePath));
  var parts = [];

  for (var i = 0; i < doc.pageItems.length; i++) {
    var item = doc.pageItems[i];
    parts.push(
      '{"index":' + i +
      ',"type":"' + escapeStr(item.typename) + '"' +
      ',"name":"' + escapeStr(item.name || "") + '"}'
    );
  }

  var resultFile = new File(params.resultFile);
  resultFile.open("w");
  resultFile.write('{"items":[' + parts.join(",") + "]}");
  resultFile.close();

  doc.close(SaveOptions.DONOTSAVECHANGES);
})();
