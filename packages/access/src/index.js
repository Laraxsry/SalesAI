/**
 * Minimal RBAC. Workspaces own products/agents; members have roles.
 */
export const ROLES = Object.freeze({
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    EDITOR: 'EDITOR',
    VIEWER: 'VIEWER'
});

const PERMISSIONS = {
    OWNER: ['*'],
    ADMIN: ['product:*', 'knowledge:*', 'agent:*', 'member:read', 'billing:read', 'analytics:read', 'audit:read'],
    EDITOR: ['product:read', 'knowledge:*', 'agent:read,update', 'analytics:read', 'member:read', 'billing:read'],
    VIEWER: ['product:read', 'knowledge:read', 'agent:read', 'analytics:read', 'member:read', 'billing:read']
};

/** Returns true if a role grants a permission like "agent:update". */
export function can(role, permission) {
    const grants = PERMISSIONS[role] || [];
    if (grants.includes('*')) return true;
    const [domain, action] = permission.split(':');
    return grants.some((g) => {
        const [gDomain, gActions] = g.split(':');
        if (gDomain !== domain && gDomain !== '*') return false;
        if (!gActions || gActions === '*') return true;
        return gActions.split(',').includes(action);
    });
}

/** Express middleware factory enforcing a permission (expects req.member.role). */
export function requirePermission(permission) {
    return (req, res, next) => {
        const role = req.member?.role;
        if (!role || !can(role, permission)) {
            return res.status(403).json({ error: 'Forbidden', required: permission });
        }
        next();
    };
}
