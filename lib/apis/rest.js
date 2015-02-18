'use strict';

var express = require('express');

var initializeRestApi = function (master) {
    var app = express();

    app.get('/', function (req, res) {
        master.log('RestApi', 'received request ...');
        var sessionName = master.createSession({
            // resources: [
            //     {
            //         type: 'dropbox',
            //         path: '/Programming/francine/img/sakura.jpg',
            //         dst: 'sakura.jpg'
            //     }
            // ]
        });
        master.createExecution({ sessionName: sessionName, parallel: req.query.parallel ? parseInt(req.query.parallel) : 1 })
        .then(function (image) {
            res.type('png');
            res.end(image);
            master.deleteSession(sessionName);
        }).done();
    });

    app.listen(master.getRestPort(), function () {
        master.log('RestApi', 'Waiting on REST port ' + master.getRestPort() + ' for REST API request...');
    });

    return app;
};

module.exports = initializeRestApi;
