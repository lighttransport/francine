'use strict';

var argv = require('optimist').argv;

var Master = require('./master');
var Worker = require('./worker');
var Deployer = require('./deployer');

var GceInstance = require('./instances/gce');

var concatObject = require('./concat');

var start = function (argv) {
    var francine;

    switch (argv.mode) {
        case 'master':
            francine = new Master(argv);
            break;

        case 'worker':
            francine = new Worker(argv);
            break;

        case 'deploy':
            francine = new Deployer(argv);
            break;
    }

    if (!francine) {
        console.log('Francine: Error: Invalid running mode ' + argv.mode);
        process.exit(1);
    }

    francine.log('Main', '### Francine2: A Job Manager for Distributed Rendering ###');
    francine.log('Main', '###  Copyright (C) Light Transport Entertainment, Inc. ###');
    francine.log('Main', 'Running as ' + argv.mode + ' mode');

    francine.start();
};

if (argv.useMetadata) {
    var instance;

    var runner = {
        log: function (from, message) {
            console.log('Francine: ' + from + ': ' + message);
        }
    };

    switch (argv.instanceType) {
        case 'gce':
            instance = new GceInstance(runner);
            break;
    }

    if (!instance) {
        console.log('Francine: Error: Invalid instance type ' + argv.instanceType);
        process.exit(1);
    }

    console.log('Francine: Instance type for metadata retrieval: ' + argv.instanceType);

    instance.retrieveMetadata()
    .then(function (metadata) {
        start(concatObject(argv, metadata));
    });
} else {
    start(argv);
}
