(function () {
    'use strict';
    var main = document.querySelector('.landing-simple');
    if (!main) return;

    var observer = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('landing-visible');
                }
            });
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    var sections = main.querySelectorAll('.section');
    sections.forEach(function (section) {
        section.classList.add('landing-observe');
        observer.observe(section);
    });
})();
