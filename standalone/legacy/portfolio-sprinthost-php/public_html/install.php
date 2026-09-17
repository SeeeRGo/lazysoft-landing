<?php
require dirname(__DIR__).'/private/app.php';
require dirname(__DIR__).'/private/install.php';
boot(function(PDO $db, array $c) {
    if ($_SERVER['REQUEST_METHOD']==='POST') {
        if (($_SERVER['HTTP_ORIGIN']??'')!==$c['origin']) reject('Запрос с другого сайта запрещён',403);
        $key=$_POST['key']??''; if (!is_string($key)) reject('Неверный ключ');
        installPortfolio($db,$c,$key);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Готово</title><h1>Сайт установлен</h1><p>Удалите public_html/install.php и private/seed.json через файловый менеджер.</p><a href="/admin.html">Открыть админку</a></html>'; return;
    }
    if ($_SERVER['REQUEST_METHOD']!=='GET') reject('Метод не поддерживается',405);
    if (query($db,'SELECT key_hash FROM pf_settings WHERE id=1')->fetchColumn()!==null) reject('Установка уже выполнена',409);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Установка портфолио</title><h1>Установка портфолио</h1><p>Откройте эту страницу только по HTTPS. Введите ключ из файла INSTALL-KEY.txt.</p><form method="post"><label>Ключ <input name="key" type="password" required minlength="43" maxlength="43" autocomplete="off"></label><button>Установить</button></form></html>';
});
