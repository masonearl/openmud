(function () {
    var btn = document.getElementById('btn-settings');
    var dropdown = document.getElementById('settings-dropdown');
    if (!btn || !dropdown) return;
    btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropdown.hidden = !dropdown.hidden;
        btn.setAttribute('aria-expanded', String(!dropdown.hidden));
    });
    dropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () {
        dropdown.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    });
})();
