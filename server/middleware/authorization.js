import { get } from '../db.js';

export function requireRole(...allowedRoles) {
  return function roleMiddleware(req, res, next) {
    get('SELECT id, role FROM users WHERE id=?', [req.userId])
      .then((user) => {
        if (!user) {
          return res.status(401).json({
            error: 'Пользователь не найден',
          });
        }

        if (!allowedRoles.includes(user.role)) {
          return res.status(403).json({
            error: 'Недостаточно прав',
          });
        }

        req.userRole = user.role;
        next();
      })
      .catch(next);
  };
}
