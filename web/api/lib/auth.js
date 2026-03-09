async function getUserFromRequest(req) {
  try {
    const { getUserFromRequest: getEmailToolUserFromRequest } = require('../../../api/_lib/emailTools');
    const result = await getEmailToolUserFromRequest(req);
    const user = result && result.user ? result.user : null;
    if (!user || !user.id) return null;
    return {
      id: user.id,
      email: user.email || '',
      accessToken: result.accessToken || '',
      user,
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  getUserFromRequest,
};
