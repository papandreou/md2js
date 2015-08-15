var esprima = require('esprima');
var escodegen = require('escodegen');
var MagicPen = require('magicpen');
var magicPen = new MagicPen().use(require('magicpen-prism'));
var pathModule = require('path');

function extend(target) {
    for (var i = 1; i < arguments.length; i += 1) {
        var source = arguments[i];
        Object.keys(source).forEach(function (key) {
            target[key] = source[key];
        });
    }
    return target;
}

function parseBlockInfo(lang) {
    var m = /^(\w+)#(\w+:\w+(,\w+:\w+)*)/.exec(lang);
    var flags = { evaluate: true };
    if (m) {
        lang = m[1];
        extend(flags, parseFlags(m[2]));
    }

    if (lang === 'js') {
        lang = 'javascript';
    }

    return {
        lang: lang,
        flags: flags
    };
}

function parseFlags(flagsString) {
    var flags = {};
    flagsString.split(/,/).forEach(function (flagString) {
        var m = /(\w+):(\w+)/.exec(flagString);
        flags[m[1]] = m[2] === 'true';
    });
    return flags;
}

var codeBlockRegExp = /^```(\S+)?\n([\s\S]*?)\s*```/gm;

function parseFunctionBody(fn) {
    return esprima.parse(fn.toString()).body[0].body.body;
}

function instrumentReturns(astNode, exampleNumber) {
    if (Array.isArray(astNode)) {
        for (var i = 0 ; i < astNode.length ; i += 1) {
            var statement = astNode[i];
            if (statement.type === 'ReturnStatement') {
                astNode.splice(i, 1, {
                    type: 'ExpressionStatement',
                    expression: {
                        type: 'AssignmentExpression',
                        operator: '=',
                        left: { type: 'Identifier', name: '__returnValue' + exampleNumber },
                        right: statement.argument
                    }
                }, {
                    type: 'BreakStatement',
                    label: {
                        type: 'Identifier',
                        name: 'example' + exampleNumber
                    }
                });
            } else if (statement.type === 'IfStatement') {
                instrumentReturns(statement.consequent, exampleNumber);
                instrumentReturns(statement.alternate, exampleNumber);
            }
        }
    } else if (astNode && typeof astNode === 'object') {
        if (astNode.type === 'BlockStatement') {
            instrumentReturns(astNode.body, exampleNumber);
        }
    }
}

function makeTryCatchConstruct(exampleNumber, topLevelStatements) {
    var tryCatch = parseFunctionBody(function f() {
        var __returnValueX;
        exampleX: try {
        } catch (err) {
            return endOfExampleX(err);
        }
        if (isPromise(__returnValueX)) {
            return __returnValueX.then(function () {
                endOfExampleX();
            }, endOfExampleX);
        } else {
            return endOfExampleX();
        }
        function endOfExampleX(err) {}
    });

    tryCatch[0].declarations[0].id.name = '__returnValue' + exampleNumber;
    tryCatch[1].label.name = 'example' + exampleNumber;
    tryCatch[1].body.handler.body.body[0].argument.callee.name = 'endOfExample' + exampleNumber;
    tryCatch[2].test.arguments[0].name = '__returnValue' + exampleNumber;
    tryCatch[2].consequent.body[0].argument.callee.object.name = '__returnValue' + exampleNumber;
    tryCatch[2].consequent.body[0].argument.arguments[1].name = 'endOfExample' + exampleNumber;
    tryCatch[2].consequent.body[0].argument.arguments[0].body.body[0].expression.callee.name = 'endOfExample' + exampleNumber;
    tryCatch[2].alternate.body[0].argument.callee.name = 'endOfExample' + exampleNumber;
    tryCatch[3].id.name = 'endOfExample' + exampleNumber;

    instrumentReturns(topLevelStatements, exampleNumber);

    Array.prototype.push.apply(tryCatch[1].body.block.body, topLevelStatements);
    return tryCatch;
}

module.exports = function (mdSrc, fileName) {
    if (fileName) {
        fileName = pathModule.relative(process.cwd(), fileName);
    } else {
        fileName = 'inline code';
    }
    codeBlockRegExp.lastIndex = 0;
    var codeBlocks = [];
    var matchCodeBlock;
    while ((matchCodeBlock = codeBlockRegExp.exec(mdSrc))) {
        var codeBlock = parseBlockInfo(matchCodeBlock[1]);
        codeBlock.code = matchCodeBlock[2];
        codeBlock.index = matchCodeBlock.index;
        if (codeBlock.lang === 'output') {
            var lastJavaScriptBlock = codeBlocks[codeBlocks.length - 1];
            if (!lastJavaScriptBlock || 'output' in lastJavaScriptBlock) {
                throw new Error('output block must follow code block');
            }
            lastJavaScriptBlock.output = codeBlock.code;
        } else if (codeBlock.lang === 'javascript' && codeBlock.flags.evaluate) {
            codeBlocks.push(codeBlock);
        }
    }

    var ast = {
        type: 'Program',
        body: parseFunctionBody(function f() {
            function isPromise (obj) {
                return obj && typeof obj.then === 'function';
            }
            var unexpected = require('unexpected');
            unexpected.output.preferredWidth = 80;
            describe('', function () {
            });
        })};

    var describeCall = ast.body[3].expression;

    describeCall.arguments[0].value = fileName;

    codeBlocks.forEach(function (codeBlock, i) {
        var exampleNumber = i + 1;
        var itExpressionStatement = parseFunctionBody(function f() {
            it('', function () {
                var expect = unexpected.clone();
            });
        })[0];
        var pen = magicPen.clone().indentLines().i().i().i().block(function () {
            this.code(codeBlock.code, 'javascript');
        });
        itExpressionStatement.expression.arguments[0].value = 'example #' + exampleNumber + ':\n' + pen.toString('ansi');

        describeCall.arguments[1].body.body.push(itExpressionStatement);

        var cursor = itExpressionStatement.expression.arguments[1].body.body;

        for (var j = 0 ; j <= i ; j += 1) {
            var codeBlock = codeBlocks[j];
            var isLast = j === i;
            var previousExampleNumber = j + 1;
            var topLevelStatements = esprima.parse('(function () {' + codeBlock.code + '}());').body[0].expression.callee.body.body;
            if (codeBlock.flags.freshExpect) {
                Array.prototype.push.apply(cursor, parseFunctionBody(function f() {
                    expect = unexpected.clone();
                }));
            }

            var tryCatch = makeTryCatchConstruct(previousExampleNumber, topLevelStatements);

            Array.prototype.push.apply(cursor, tryCatch);

            cursor = tryCatch[3].body.body;
            if (j === i) {
                var check;
                if (typeof codeBlock.output === 'string') {
                    check = parseFunctionBody(function f() {
                        if (err) {
                            expect(err, 'to have message', 'expectedErrorMessage');
                        } else {
                            throw new Error('expected example 1 to fail');
                        }
                    });
                    check[0].consequent.body[0].expression.arguments[2].value = codeBlock.output;
                } else {
                    check = parseFunctionBody(function f() {
                        if (err) {
                            expect.fail(err);
                        }
                    });
                }
                Array.prototype.push.apply(cursor, check);
            }
        }
    });
    return escodegen.generate(ast);
};
