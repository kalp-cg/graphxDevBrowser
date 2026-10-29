import { z } from 'zod';

export const ApiParamSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().optional()
});
export type ApiParam = z.infer<typeof ApiParamSchema>;

export const ApiHeaderSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().optional()
});
export type ApiHeader = z.infer<typeof ApiHeaderSchema>;

export const ApiRequestBodySchema = z.object({
  mode: z.enum(['none', 'json', 'form-data', 'x-www-form-urlencoded', 'raw', 'graphql']),
  raw: z.string().optional(),
  graphql: z.object({
    query: z.string(),
    variables: z.string().optional()
  }).optional()
});
export type ApiRequestBody = z.infer<typeof ApiRequestBodySchema>;

export const ApiAssertionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  script: z.string(),
  passed: z.boolean().optional(),
  errorMessage: z.string().optional()
});
export type ApiAssertion = z.infer<typeof ApiAssertionSchema>;

export const ApiRequestDraftSchema = z.object({
  id: z.string().uuid(),
  collectionId: z.string().uuid().optional(),
  name: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
  url: z.string(),
  headers: z.array(ApiHeaderSchema),
  queryParams: z.array(ApiParamSchema),
  body: ApiRequestBodySchema,
  preRequestScript: z.string().optional(),
  postResponseScript: z.string().optional(),
  assertions: z.array(ApiAssertionSchema).default([])
});
export type ApiRequestDraft = z.infer<typeof ApiRequestDraftSchema>;

export const EnvironmentVariableSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  value: z.string(),
  isSecret: z.boolean().default(false),
  enabled: z.boolean().default(true)
});
export type EnvironmentVariable = z.infer<typeof EnvironmentVariableSchema>;

export const EnvironmentProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  variables: z.array(EnvironmentVariableSchema),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type EnvironmentProfile = z.infer<typeof EnvironmentProfileSchema>;

export const ApiCollectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  requests: z.array(ApiRequestDraftSchema),
  environmentVariables: z.array(EnvironmentVariableSchema).default([]),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type ApiCollection = z.infer<typeof ApiCollectionSchema>;
