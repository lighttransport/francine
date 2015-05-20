(function() {
  'use strict';

  var socket = io();

  socket.on('auth', function onAuth(url) {
    window.open(url, '_blank');
  });

  var canvas = new fabric.Canvas('c', {
    selection: false
  });

  var eye = new fabric.Circle({
    radius: 10, fill: 'red', left: 100, top: 100, hasControls: false, hasBorders: false
  });

  var lookat = new fabric.Circle({
    radius: 10, fill: 'green', left: 100, top: 50, hasControls: false, hasBorders: false
  });

  function moving(e) {
    e.target.opacity = 0.5;
  }

  function mix(a, b, ratio) {
    return a * (1 - ratio) + b * ratio;
  }

  var xmin = -80, xmax = 80;
  var zmin = -80, zmax = 80;
  var yeye = 20;
  var ylookat = 0;

  function change(e) {
    e.target.opacity = 1.0;
    eye.selectable = lookat.selectable = false;

    socket.emit('view_changed', {
      eye: [
        mix(xmin, xmax, eye.getTop() / 200),
        yeye,
        mix(zmin, zmax, eye.getLeft() / 200)],
      lookat: [
        mix(xmin, xmax, lookat.getTop() / 200),
        ylookat,
        mix(zmin, zmax, lookat.getLeft() / 200)]
    });
  }

  canvas.on('object:moving', moving);
  canvas.on('object:modified', change);

  canvas.add(eye, lookat);

  socket.on('updated', function onUpdated(image) {
    eye.selectable = lookat.selectable = true;
    document.getElementById('i').src = 'data:image/jpg;base64,' + image;
  });
})();
