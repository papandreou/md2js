var fs = require('fs');
var md2js = require('./lib/md2js');

require.extensions['.md'] = function (module, fileName) {
    module._compile(md2js(fs.readFileSync(fileName, 'utf-8'), fileName), fileName);
};
