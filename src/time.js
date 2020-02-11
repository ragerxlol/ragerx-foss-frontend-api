/* our db epoch is 01/01/2010 */
export const now = () => Math.floor(Date.now() / 1000)
export const db_time_to_walltime = db_time => db_time + 1262304000
export const walltime_to_db_time = walltime => walltime - 1262304000
export const unix_to_js = time => time * 1000
export const js_to_unix = time => Math.floor(time / 1000)
export const start_of_1_min = time => Math.floor(time / (60 * 1)) * (60 * 1)
export const start_of_5_min = time => Math.floor(time / (60 * 5)) * (60 * 5)
export const start_of_1_hr  = time => Math.floor(time / (60 * 60)) * (60 * 60)
