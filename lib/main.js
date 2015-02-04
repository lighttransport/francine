'use strict';

var argv = require('optimist').argv;

var Master = require('./master');
var Worker = require('./worker');

var francine;

switch (argv.mode) {
    case 'master':
        francine = new Master(argv);
        break;

    case 'worker':
        francine = new Worker(argv);
        break;
}

if (!francine) {
    console.log('Francine: Error: Invalid running mode ' + argv.mode);
    process.exit(1);
}

console.log('Francine2: A Job Manager for Distributed Rendering');
console.log('Running as ' + argv.mode + ' mode');

// This is synchronous method.
francine.start();

