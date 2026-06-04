(function (global) {
    function isImageAvatar(avatar) {
        if (!avatar || typeof avatar !== 'string') return false;
        const t = avatar.trim();
        return t.startsWith('data:image')
            || t.startsWith('http://')
            || t.startsWith('https://')
            || t.startsWith('blob:');
    }

    function mountAvatar(container, avatar, options = {}) {
        if (!container) return;
        const fallback = options.fallback || '🦊';
        const imgClass = options.imgClass || 'w-full h-full object-cover';
        const emojiClass = options.emojiClass || '';

        container.innerHTML = '';
        container.classList.add('avatar-mount');
        if (isImageAvatar(avatar)) {
            const img = document.createElement('img');
            img.src = avatar;
            img.alt = options.alt || 'Avatar';
            img.className = imgClass;
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => {
                container.textContent = fallback;
                container.classList.add(emojiClass);
            };
            container.appendChild(img);
            return;
        }
        const span = document.createElement('span');
        span.className = emojiClass;
        span.textContent = (avatar && String(avatar).trim()) || fallback;
        container.appendChild(span);
    }

    function avatarBoxHtml(avatar, boxClass, options = {}) {
        return `<div class="avatar-box ${boxClass || ''}" data-avatar="${encodeURIComponent(avatar || '')}"></div>`;
    }

    function hydrateAvatarBoxes(root) {
        const scope = root || document;
        scope.querySelectorAll('.avatar-box[data-avatar]').forEach(el => {
            try {
                const raw = decodeURIComponent(el.getAttribute('data-avatar') || '');
                mountAvatar(el, raw, {
                    imgClass: el.dataset.imgClass || 'w-full h-full object-cover rounded-full',
                    emojiClass: el.dataset.emojiClass || 'text-lg',
                    fallback: el.dataset.fallback || '🦊'
                });
            } catch (_) {
                mountAvatar(el, '🦊');
            }
        });
    }

    global.AvatarUI = {
        isImageAvatar,
        mountAvatar,
        avatarBoxHtml,
        hydrateAvatarBoxes
    };
})(window);
