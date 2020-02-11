export const get_or_empty_obj = (obj, key) => obj.hasOwnProperty(key) ? obj[key] : {}
export const get_or_empty_arr = (obj, key) => obj.hasOwnProperty(key) ? obj[key] : []
export const get_or_zero_obj = (obj, key) => obj.hasOwnProperty(key) ? obj[key] : 0
export const get_or_empty_map = (map, key) => map.has(key) ? map.get(key) : {}
export const get_or_default_map = (map, key) => map.has(key) ? map.get(key) : map.get(-1)
