<?php
function validate(PDO $db, mixed $c): array {
    $schema=json_decode(file_get_contents(__DIR__.'/cms-schema.json'),true,32,JSON_THROW_ON_ERROR);
    if (!is_array($c) || !is_array($c['values']??null) || !is_array($c['items']??null)) reject('Некорректное содержимое');
    $record=function(array $fields,mixed $row) use($db): array {
        if (!is_array($row)) reject('Некорректная запись');
        $result=[];
        foreach($fields as $f) {
            $value=$row[$f['key']]??null;
            if ($f['type']==='number') {
                if ((!is_int($value) && !is_float($value)) || !is_finite((float)$value)) reject('Некорректное число');
            } else {
                if (!textValid($value,20000) || (!empty($f['required']) && !trim($value))) reject('Проверьте поле '.$f['label']);
                if ($f['type']==='url' && $value && !preg_match('~^(https?://|mailto:|tel:|#)~i',$value)) reject('Некорректная ссылка');
                if ($f['type']==='image' && $value) {
                    if (preg_match('~^/asset\.php\?id=([A-Za-z0-9_-]{1,80})$~D',$value,$m)) {
                        $asset=query($db,'SELECT type FROM pf_assets WHERE id=?',[$m[1]])->fetch();
                        if (!$asset || !str_starts_with($asset['type'],'image/')) reject('Изображение не найдено');
                    } elseif (!preg_match('~^[A-Za-z0-9][A-Za-z0-9_./-]*\.(png|jpe?g|webp|svg)$~iD',$value) || in_array('..',explode('/',$value),true)) reject('Некорректное изображение');
                }
            }
            $result[$f['key']]=$value;
        }
        return $result;
    };
    $result=['values'=>$record($schema['fields'],$c['values']),'items'=>[]];
    foreach($schema['collections'] as $collection) {
        $rows=$c['items'][$collection['key']]??null;
        if (!is_array($rows) || !array_is_list($rows)) reject('Некорректный каталог');
        $seen=[];$items=[];
        foreach($rows as $row) {
            if (!is_array($row) || !is_string($row['id']??null) || !preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,79}$/D',$row['id']) || in_array($row['id'],['__proto__','constructor','prototype'],true) || isset($seen[$row['id']])) reject('Некорректный ID записи');
            $seen[$row['id']]=true;$items[]=array_merge(['id'=>$row['id']],$record($collection['fields'],$row));
        }
        $result['items'][$collection['key']]=$items;
    }
    $result['values']=(object)$result['values'];
    $result['items']=(object)$result['items'];
    return $result;
}
