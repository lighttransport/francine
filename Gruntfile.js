module.exports = function(grunt) {
  'use strict';

  grunt.initConfig({
    nodeunit: {
      files: ['test/**/*_test.js']
    },
    jshint: {
      options: {
        jshintrc: '.jshintrc'
      },
      all: ['Gruntfile.js', 'lib/**/*.js', 'test/**/*.js']
    },
    jscs: {
      src: '<%= jshint.all %>'
    },
    watch: {
      files: '<%= jshint.all %>',
      tasks: ['jshint', 'jscs', 'nodeunit']
    }
  });

  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-nodeunit');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-jscs');

  grunt.registerTask('default', ['jshint', 'jscs', 'nodeunit']);
};
