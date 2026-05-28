(function () {
    'use strict';

    function addMyButton(e) {
        // Чекаємо, поки сторінка фільму повністю завантажиться
        if (e.type !== 'complite') return;
        
        var render = e.object.activity.render();
        
        // Захист від дублювання кнопки
        if (render.find('.view--my-pl').length) return;

        // Створення кнопки з правильною структурою Lampa (з внутрішнім div)
        var btn = $('<div class="full-start__button selector view--my-pl"><div><span>my</span></div></div>');

        // Додаємо кнопку в панель
        render.find('.full-start__buttons').append(btn);

        // Обробка натискання
        btn.on('hover:enter', function () {
            var card = e.object.card_data || e.object.movie;
            var query = card.title || card.name || card.original_title;

            if (!query) {
                Lampa.Noty.show('Немає назви для пошуку');
                return;
            }

            Lampa.Loading.start();
            var network = new Lampa.Reguest();
            
            // 1. Пошук на Anwap
            network.native('https://my.anwap.love/films/search/?slv=' + encodeURIComponent(query), function (html) {
                var items = [];
                // Шукаємо картки фільмів у HTML
                var regex = /<a href=["'](\/films\/\d+)["'][^>]*>[\s\S]*?<div class="namefilm">([^<]+)<\/div>/g;
                var match;
                
                while ((match = regex.exec(html)) !== null) {
                    items.push({
                        title: match[2].trim(),
                        url: 'https://mm.anwap.media' + match[1],
                        subtitle: 'Anwap'
                    });
                }

                Lampa.Loading.stop();

                if (!items.length) {
                    Lampa.Noty.show('На Anwap нічого не знайдено');
                    return;
                }

                // 2. Відкриваємо стандартне меню вибору Lampa
                Lampa.Select.show({
                    title: 'Знайдено на Anwap',
                    items: items,
                    onSelect: function (item) {
                        Lampa.Select.close();
                        Lampa.Loading.start();

                        // 3. Завантажуємо сторінку вибраного фільму
                        network.native(item.url, function (filmHtml) {
                            // Шукаємо iframe з ZenithJS
                            var iframeMatch = filmHtml.match(/https:\/\/api\.zenithjs\.ws\/embed\/(movie|tv)\/\d+/i);
                            
                            if (!iframeMatch) {
                                Lampa.Loading.stop();
                                Lampa.Noty.show('Плеєр ZenithJS не знайдено');
                                return;
                            }

                            // 4. Завантажуємо код самого плеєра (iframe)
                            network.native(iframeMatch[0], function (iframeHtml) {
                                Lampa.Loading.stop();
                                
                                // Шукаємо m3u8 посилання
                                var streamMatch = iframeHtml.match(/m=(https?%3A%2F%2F[^"&]+master\.m3u8[^"&]*)/i) || 
                                                  iframeHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                                
                                if (streamMatch) {
                                    var m3u8Url = streamMatch[1];
                                    // Якщо URL закодований, розкодовуємо його
                                    if (m3u8Url.indexOf('%') > -1) {
                                        m3u8Url = decodeURIComponent(m3u8Url);
                                    }
                                    
                                    // 5. Запуск відео в плеєрі Lampa
                                    Lampa.Player.play({
                                        url: m3u8Url,
                                        title: item.title,
                                        card: card
                                    });
                                    Lampa.Player.callback({ url: m3u8Url, title: item.title });
                                    
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

    // Реєстрація плагіна під час старту Лампи
    if (window.appready) {
        Lampa.Listener.follow('full', addMyButton);
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                Lampa.Listener.follow('full', addMyButton);
            }
        });
    }

})();
