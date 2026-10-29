import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { ROLES } from '@fs-review/shared';

extendZodWithOpenApi(z);

export const RoleSchema = z.enum(ROLES).openapi('Role');

export const PublicUserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    email: z.string(),
    role: RoleSchema,
    active: z.boolean(),
    createdAt: z.string(),
    lastSignInAt: z.string().nullable()
  })
  .openapi('User');

export const AuthStatusResponse = z.object({ setupRequired: z.boolean(), resetAvailable: z.boolean() }).openapi('AuthStatus');
export const UserResponse = z.object({ user: PublicUserSchema }).openapi('UserResponse');
export const MeResponse = z.object({ user: PublicUserSchema.nullable() }).openapi('MeResponse');
export const UsersResponse = z.object({ users: z.array(PublicUserSchema) }).openapi('UsersResponse');
export const PeopleResponse = z
  .object({ people: z.array(z.object({ id: z.string(), name: z.string(), role: RoleSchema, active: z.boolean() })) })
  .openapi('PeopleResponse');

const str = (max: number) => z.string().trim().max(max);

export const SetupBody = z
  .object({ name: str(120), username: str(40), password: z.string().max(200), email: str(254).optional() })
  .openapi('SetupBody');
export const LoginBody = z.object({ username: z.string().max(200), password: z.string().max(200) }).openapi('LoginBody');
export const CreateUserBody = z
  .object({ name: str(120), username: str(40), password: z.string().max(200), role: z.string().max(40), email: str(254).optional() })
  .openapi('CreateUserBody');
export const UpdateUserBody = z
  .object({
    name: str(120).optional(),
    role: z.string().max(40).optional(),
    active: z.boolean().optional(),
    email: str(254).optional(),
    password: z.string().max(200).optional()
  })
  .openapi('UpdateUserBody');
export const UserIdParams = z.object({ id: z.string().min(1).max(64) });
export const ForgotBody = z.object({ login: z.string().max(254) }).openapi('ForgotBody');
export const ResetBody = z.object({ token: z.string().max(200), password: z.string().max(200) }).openapi('ResetBody');
export const OkResponse = z.object({ ok: z.literal(true), message: z.string().optional() }).openapi('OkResponse');

export const PermissionMatrixSchema = z.record(z.string(), z.array(z.string())).openapi('PermissionMatrix');
export const PermissionsResponse = z.object({ matrix: PermissionMatrixSchema }).openapi('PermissionsResponse');
export const PermissionsBody = z.object({ matrix: z.unknown() }).openapi('PermissionsBody');
