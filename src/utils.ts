export function serialize(formData: FormData) {
  let object = {};
  for (const input of formData.entries()) {
    const [key, value] = input;
    if (!Reflect.has(object, key)) {
      object[key] = value;
      return;
    }
    if (!Array.isArray(object[key])) {
      object[key] = [object[key]];
    }
    object[key].push(value);
  }

  return object;
}
