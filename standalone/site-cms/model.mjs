export const format = 'lazysoft-cms-v1';
const id = s => typeof s === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(s) && !['__proto__','constructor','prototype'].includes(s);
const types = new Set(['text','textarea','number','image','url']);
export function validateSchema(schema) {
  if (!schema || schema.format !== format || !Array.isArray(schema.fields) || !Array.isArray(schema.collections)) throw Error('Invalid CMS schema');
  const fields = list => {
    if (!Array.isArray(list) || list.length > 80) throw Error('Invalid CMS fields');
    const seen = new Set();
    for (const f of list) {
      if (!id(f.key) || f.key === 'id' || seen.has(f.key) || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 160 || !types.has(f.type)) throw Error('Invalid CMS field');
      seen.add(f.key);
    }
  };
  fields(schema.fields);
  const seen = new Set();
  if (schema.collections.length > 40) throw Error('Too many different CMS collection types');
  for (const c of schema.collections) {
    if (!id(c.key) || seen.has(c.key) || typeof c.label !== 'string' || !c.label.trim() || c.label.length > 160) throw Error('Invalid CMS collection');
    seen.add(c.key); fields(c.fields);
    if (!c.fields.some(f=>f.type==='text'||f.type==='textarea') || !c.fields.some(f=>f.type==='image')) throw Error('Catalog needs a text field and an image field');
    if(c.page!==undefined && (!/^[A-Za-z0-9_-]+\.html$/.test(c.page))) throw Error('Invalid collection page');
  }
  return schema;
}
export function safeImage(value, demo = false) {
  if (value === '') return true;
  if (typeof value !== 'string') return false;
  if (demo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
  if (/^\/api\/portfolio\/assets\/[A-Za-z0-9_-]{1,80}$/.test(value) || /^\/asset\.php\?id=[A-Za-z0-9_-]{1,80}$/.test(value)) return true;
  return /^[A-Za-z0-9][A-Za-z0-9_./-]*\.(png|jpe?g|webp|svg)$/i.test(value) && !value.split('/').includes('..');
}
export function validateContent(schema, content, demo = false) {
  validateSchema(schema);
  if (!content || !content.values || !content.items || Array.isArray(content.values) || Array.isArray(content.items)) throw Error('Invalid CMS content');
  const record = (fields, row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Invalid record');
    const result = {};
    for (const field of fields) {
      const value = row[field.key];
      if (field.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('Некорректное число: '+field.label); }
      else {
        if (typeof value !== 'string' || value.length > (field.type === 'image' && demo ? 12*1024*1024 : 20000)) throw Error('Некорректное поле: '+field.label);
        if (field.required && !value.trim()) throw Error('Заполните: '+field.label);
        if (field.type === 'image' && !safeImage(value,demo)) throw Error('Некорректное изображение');
        if (field.type === 'url' && value && !/^(https?:\/\/|mailto:|tel:|#)/i.test(value)) throw Error('Некорректная ссылка');
      }
      result[field.key] = value;
    }
    return result;
  };
  const result = {values:record(schema.fields,content.values),items:{}};
  for (const collection of schema.collections) {
    if (!Array.isArray(content.items[collection.key])) throw Error('Отсутствует каталог: '+collection.label);
    const seen = new Set();
    result.items[collection.key] = content.items[collection.key].map(row => {
      if (!row || !id(row.id) || seen.has(row.id)) throw Error('Invalid item ID');
      seen.add(row.id); return {id:row.id,...record(collection.fields,row)};
    });
  }
  return result;
}
