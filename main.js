/* Tiny helpers only. The site works without this file. */
(function () {
  function closeLightbox() {
    if (location.hash && location.hash.indexOf('#shot-') === 0) {
      history.replaceState(null, '', location.pathname + location.search + '#screenshots');
    }
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });
  document.querySelectorAll('.lightbox').forEach(function (box) {
    box.addEventListener('click', function (e) {
      if (e.target === box) closeLightbox();
    });
  });
})();
