/** Mission time as `m:ss`, or `h:mm:ss` from one hour. */
export function formatElapsed(seconds: number) {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes % 60)}:${pad(whole % 60)}`
    : `${minutes}:${pad(whole % 60)}`;
}
