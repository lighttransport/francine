/* global io */
/* global window */
/* global document */

(function() {
  'use strict';

  var socket = io();

  document.getElementById('auth').style.display = 'none';
  document.getElementById('auth').onsubmit = function onSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    socket.emit('auth', document.getElementById('t').value);
    document.getElementById('auth').style.display = 'none';
  };

  socket.on('auth', function onAuth(url) {
    window.open(url, '_blank');
    document.getElementById('auth').style.display = 'inline';
  });

  socket.on('updated', function onUpdated(image) {
    document.getElementById('i').src = 'data:image/jpg;base64,' + image;
  });
})();
