/**
 * Disable Express request/response timeouts (for long model responses)
 * @param {any} req
 * @param {any} res
 */
export function disableTimeouts(req, res) {
  if (req && typeof req.setTimeout === 'function') req.setTimeout(0);
  if (res && typeof res.setTimeout === 'function') res.setTimeout(0);
}
