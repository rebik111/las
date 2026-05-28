(function () {
    'use strict';

    // Захист від подвійного завантаження плагіна
    if (window.plugin_my_anwap_ready) return;
    window.plugin_my_anwap_ready = true;

    function addMyButton(e) {
        if (e.type !== 'complite') return;
        
        var render = e.object.activity.render();
        
        // Перевіряємо, чи ми вже додали кнопку
        if (!render || render.find('.view--my-pl').length) return;

        // Нативна структура кнопки Lampa з іконкою Play
        var btnHtml = '<div class="full-start__button selector view--my-pl" style="background:#553c9a;color:#fff">' +
                      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1.2em;height:1.2em;margin-right:0.5em;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>' +
                      '<span>my</span>' +
                      '</div>';
        
        var btn = $(btnHtml);

        // Шукаємо блок з кнопками. Якщо його немає (інша збірка Лампи) - ставимо після трейлера
        var buttonsContainer = render.find('.full-start__buttons');
        if (buttonsContainer.length) {
            buttonsContainer.append(btn);
        } else {
            render.find('.view--torrent').after(btn);
        }

        // Логіка при натисканні (ОБОВ'ЯЗКОВО ES5: var, function)
        btn.on('hover:enter', function () {
            var card = e.object.card_data || e.object.movie;
            var query = card.title || card.name || card.original_title;

            if (!query) {
                Lampa.Noty.show('Немає назви для пошуку');
                return;
            }

            Lampa.Loading.start();
            var network = new Lampa.Reguest();
            var searchUrl = 'https://my.anwap.love/films/search/?slv=' + encodeURIComponent(query);
            
            // 1. Пошук по Anwap
            network.native(searchUrl, function (html) {
                var items = [];
                var regex = /<a href=["'](\/films\/\d+)["'][^>]*>[\s\S]*?<div class="namefilm">([^<]+)<\/div>/g;
                var match;
                
                while ((match = regex.exec(html)) !== null) {
                    items.push({
                        // Видаляємо зайві пробіли
                        title: match[2].replace(/(^\s+|\s+$)/g, ''),
                        url: 'https://mm.anwap.media' + match[1],
                        subtitle: 'Anwap'
                    });
                }

                Lampa.Loading.stop();

                if (items.length === 0) {
                    Lampa.Noty.show('На Anwap нічого не знайдено');
                    return;
                }

                // 2. Виводимо стандартне меню Lampa
                Lampa.Select.show({
                    title: 'Знайдено на Anwap',
                    items: items,
                    onSelect: function (item) {
                        Lampa.Select.close();
                        Lampa.Loading.start();

                        // 3. Завантажуємо сторінку фільму
                        network.native(item.url, function (filmHtml) {
                            var iframeMatch = filmHtml.match(/https:\/\/api\.zenithjs\.ws\/embed\/(?:movie|tv)\/\d+/i);
                            
                            if (!iframeMatch) {
                                Lampa.Loading.stop();
                                Lampa.Noty.show('Плеєр ZenithJS не знайдено');
                                return;
                            }

                            // 4. Завантажуємо код плеєра ZenithJS
                            network.native(iframeMatch[0], function (iframeHtml) {
                                Lampa.Loading.stop();
                                
                                // Шукаємо m3u8 посилання в конфізі
                                var streamMatch = iframeHtml.match(/m=(https?%3A%2F%2F[^"&]+master\.m3u8[^"&]*)/i) || 
                                                  iframeHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                                
                                if (streamMatch) {
                                    var m3u8Url = streamMatch[1];
                                    if (m3u8Url.indexOf('%') > -1) {
                                        m3u8Url = decodeURIComponent(m3u8Url);
                                    }
                                    
                                    // 5. Передаємо посилання в плеєр Lampa
                                    Lampa.Player.play({
                                        url: m3u8Url,
                                        title: item.title,
                                        card: card
                                    });
                                    Lampa.Player.playlist([{ url: m3u8Url, title: item.title }]);
                                    
                                } else {
                                    Lampa.Noty.show('Не вдалося знайти потік відео');
                                }
                            }, function() { 
                                Lampa.Loading.stop(); 
                                Lampa.Noty.show('Помилка завантаження плеєра'); 
                            }, false, {dataType: 'text'});

                        }, function() { 
                            Lampa.Loading.stop(); 
                            Lampa.Noty.show('Помилка завантаження сторінки фільму'); 
                        }, false, {dataType: 'text'});
                    },
                    onBack: function () {
                        Lampa.Select.close();
                    }
                });

            }, function () {
                Lampa.Loading.stop();
                Lampa.Noty.show('Помилка запиту до Anwap');
            }, false, {dataType: 'text'});
        });
    }

    // Реєстрація подій (обов'язково з урахуванням того, коли ініціалізується Lampa)
    function init() {
        Lampa.Listener.follow('full', addMyButton);
        console.log('My PL (Anwap) loaded successfully');
    }

    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') init();
        });
    }

})();
