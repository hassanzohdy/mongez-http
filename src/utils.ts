export function serialize(formData: FormData) {
  let object: any = {};
  const data: any = formData.entries();
  for (const input of data) {
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
