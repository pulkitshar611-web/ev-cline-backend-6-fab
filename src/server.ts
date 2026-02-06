import dotenv from 'dotenv';
dotenv.config({ override: true });

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { PrismaClient } from '@prisma/client';

import authRoutes from './routes/auth.routes.js';
import superRoutes from './routes/super.routes.js';
import receptionRoutes from './routes/reception.routes.js';
import doctorRoutes from './routes/doctor.routes.js';
import billingRoutes from './routes/billing.routes.js';
import clinicRoutes from './routes/clinic.routes.js';
import departmentRoutes from './routes/department.routes.js';
import patientRoutes from './routes/patient.routes.js';
import formsRoutes from './routes/forms.routes.js';
import pharmacyRoutes from './routes/pharmacy.routes.js';
import labRoutes from './routes/lab.routes.js';
import documentRoutes from './routes/document.routes.js';

import { startTime } from './utils/system.js';

const app = express();
export const prisma = new PrismaClient();

const PORT = Number(process.env.PORT) || 5000;

console.log('🔌 Connecting to Database URL:', process.env.DATABASE_URL);

/* -------------------- SECURITY & PERFORMANCE -------------------- */

app.use(helmet());
app.use(compression());
app.use(morgan('dev'));

/* -------------------- ✅ CORS (NODE 22 SAFE) -------------------- */

const allowedOrigins = [
  'https://ev-clinic.kiaantechnology.com',
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server & Postman
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-clinic-id'
    ]
  })
);

/* ⚠️ IMPORTANT
   - NO manual OPTIONS handler
   - NO app.options('*')
   - cors() already handles preflight correctly
*/

/* -------------------- BODY PARSERS -------------------- */

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* -------------------- ROUTES -------------------- */

app.use('/api/auth', authRoutes);
app.use('/api/super', superRoutes);
app.use('/api/reception', receptionRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/clinic', clinicRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/lab', labRoutes);
app.use('/api/document-controller', documentRoutes);

/* -------------------- HEALTH CHECK -------------------- */

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Exclusive Vision HIS API is fully operational 🚀'
  });
});

/* -------------------- GLOBAL ERROR HANDLER -------------------- */

app.use(
  (err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Internal Server Error'
    });
  }
);

/* -------------------- SERVER START -------------------- */

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 EV Clinic HIS Backend
--------------------------------
Status : RUNNING
Port   : ${PORT}
Env    : ${process.env.NODE_ENV || 'production'}
Started: ${startTime}
--------------------------------
`);
});

/* -------------------- GRACEFUL SHUTDOWN -------------------- */

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
