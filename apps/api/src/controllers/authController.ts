import type { Request, Response } from 'express';

import { prisma } from '../lib/prisma.js';
import { comparePasswords, createAuthToken, hashPassword, loginSchema, registerSchema } from '../services/authService.js';

export async function registerUser(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid registration payload.', issues: parsed.error.flatten() });
    return;
  }

  const { email, fullName, password } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    res.status(409).json({ message: 'An account already exists for this email.' });
    return;
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash,
      role: 'MEMBER',
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      createdAt: true,
    },
  });

  const token = createAuthToken({ id: user.id, email: user.email, role: user.role });

  res.status(201).json({
    message: 'Account created successfully.',
    user,
    token,
  });
}

export async function loginUser(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid login payload.', issues: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    res.status(401).json({ message: 'Invalid email or password.' });
    return;
  }

  const isPasswordValid = await comparePasswords(password, user.passwordHash);

  if (!isPasswordValid) {
    res.status(401).json({ message: 'Invalid email or password.' });
    return;
  }

  const token = createAuthToken({ id: user.id, email: user.email, role: user.role });

  res.json({
    message: 'Login successful.',
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      createdAt: user.createdAt,
    },
    token,
  });
}

export async function getCurrentUser(req: Request, res: Response) {
  const authUser = (req as any).user;

  if (!authUser) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    res.status(404).json({ message: 'User not found.' });
    return;
  }

  res.json({ user });
}
