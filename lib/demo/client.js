(function() {
  'use strict';

  var socket = io();

  socket.on('updated', function onUpdated(image) {
    document.getElementById('i').src = 'data:image/jpg;base64,' + image;
  });

  socket.on('auth', function onAuth(url) {
    window.open(url, '_blank');
  });

  var canvas = new fabric.Canvas('c', {
    selection: false
  });

  var eye = new fabric.Circle({
    radius: 20, fill: 'red', left: 100, top: 100, hasControls: false, hasBorders: false
  });

  var lookat = new fabric.Circle({
    radius: 20, fill: 'green', left: 100, top: 50, hasControls: false, hasBorders: false
  });

  function moving(e) {
    e.target.opacity = 0.5;
  }

  function change(e) {
    e.target.opacity = 1.0;
    socket.emit('view_changed', {
      eye: [eye.getTop(), eye.getLeft(), 1],
      lookat: [lookat.getTop(), lookat.getLeft(), 1]
    });
  }

  canvas.on('object:moving', moving);
  canvas.on('object:modified', change);

  canvas.add(eye, lookat);

})();
