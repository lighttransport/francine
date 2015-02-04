'use strict';

exports.awesome = {
    setUp: function (done) {
        done();
    },

    placeholder: function(test) {
        test.expect(1);
        test.equal('a', 'a', 'placeholder');
        test.done();
    }
};

