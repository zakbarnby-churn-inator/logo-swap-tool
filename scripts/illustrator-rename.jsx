// Expects a global `params` object with: templatePath, index, newName
// Uses the index from the scan step (doc.pageItems order) since pasted/grouped
// artwork often has no existing name to match against.

(function main() {
  var doc = app.open(new File(params.templatePath));

  if (params.index < 0 || params.index >= doc.pageItems.length) {
    doc.close(SaveOptions.DONOTSAVECHANGES);
    throw new Error("Item index out of range: " + params.index);
  }

  doc.pageItems[params.index].name = params.newName;
  doc.close(SaveOptions.SAVECHANGES);
})();
