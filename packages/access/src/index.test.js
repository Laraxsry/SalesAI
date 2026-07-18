import { describe, it, expect, vi } from 'vitest';
import { ROLES, can, requirePermission } from './index.js';

/**
 * can() is the authorization boundary in front of every route. The grant
 * strings ('agent:read,update', 'product:*') are parsed by hand, so a small
 * refactor could silently widen a role's access. These tests pin the full
 * role/permission matrix, especially the denials.
 */
describe('can', () => {
    it('OWNER can do everything, including future/unknown permissions', () => {
        expect(can(ROLES.OWNER, 'agent:delete')).toBe(true);
        expect(can(ROLES.OWNER, 'member:manage')).toBe(true);
        expect(can(ROLES.OWNER, 'billing:manage')).toBe(true);
    });

    describe('ADMIN', () => {
        it('has wildcard access to product/knowledge/agent domains', () => {
            expect(can(ROLES.ADMIN, 'product:delete')).toBe(true);
            expect(can(ROLES.ADMIN, 'knowledge:create')).toBe(true);
            expect(can(ROLES.ADMIN, 'agent:activate')).toBe(true);
        });

        it('can read members but not manage them', () => {
            expect(can(ROLES.ADMIN, 'member:read')).toBe(true);
            expect(can(ROLES.ADMIN, 'member:manage')).toBe(false);
        });

        it('has no access to ungranted domains', () => {
            expect(can(ROLES.ADMIN, 'billing:manage')).toBe(false);
        });
    });

    describe('EDITOR', () => {
        it('can update agents but not delete them (comma-list grant)', () => {
            expect(can(ROLES.EDITOR, 'agent:read')).toBe(true);
            expect(can(ROLES.EDITOR, 'agent:update')).toBe(true);
            expect(can(ROLES.EDITOR, 'agent:delete')).toBe(false);
        });

        it('can only read products, but fully manage knowledge', () => {
            expect(can(ROLES.EDITOR, 'product:read')).toBe(true);
            expect(can(ROLES.EDITOR, 'product:update')).toBe(false);
            expect(can(ROLES.EDITOR, 'knowledge:delete')).toBe(true);
        });
    });

    describe('VIEWER', () => {
        it('is read-only across all granted domains', () => {
            for (const domain of ['product', 'knowledge', 'agent', 'analytics']) {
                expect(can(ROLES.VIEWER, `${domain}:read`)).toBe(true);
            }
            expect(can(ROLES.VIEWER, 'product:update')).toBe(false);
            expect(can(ROLES.VIEWER, 'knowledge:create')).toBe(false);
            expect(can(ROLES.VIEWER, 'agent:update')).toBe(false);
        });
    });

    it('denies unknown or missing roles', () => {
        expect(can('SUPERUSER', 'product:read')).toBe(false);
        expect(can(undefined, 'product:read')).toBe(false);
        expect(can(null, 'product:read')).toBe(false);
    });
});

describe('requirePermission', () => {
    const mockRes = () => {
        const res = { status: vi.fn(), json: vi.fn() };
        res.status.mockReturnValue(res);
        return res;
    };

    it('calls next() when the member role grants the permission', () => {
        const next = vi.fn();
        const res = mockRes();
        requirePermission('agent:update')({ member: { role: 'EDITOR' } }, res, next);
        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('responds 403 when the role lacks the permission', () => {
        const next = vi.fn();
        const res = mockRes();
        requirePermission('agent:delete')({ member: { role: 'EDITOR' } }, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden', required: 'agent:delete' });
    });

    it('responds 403 when there is no member on the request at all', () => {
        const next = vi.fn();
        const res = mockRes();
        requirePermission('product:read')({}, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
