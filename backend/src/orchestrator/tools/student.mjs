import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../db.mjs";
import { tool } from "@strands-agents/sdk";
import { z } from "zod";

export async function getStudentProfile(studentId) {
  const resp = await ddb.send(new GetCommand({
    TableName: process.env.STUDENTS_TABLE,
    Key: { PK: `STUDENT#${studentId}`, SK: "PROFILE" },
  }));
  return resp.Item ?? null;
}

export async function saveStudentProfile(profile) {
  const { studentId } = profile;
  await ddb.send(new PutCommand({
    TableName: process.env.STUDENTS_TABLE,
    Item: {
      PK: `STUDENT#${studentId}`,
      SK: "PROFILE",
      ...profile,
      updatedAt: new Date().toISOString(),
    },
  }));
}

export const getProfile = tool({
  name: "get_student_profile",
  description: "Get the current student's full academic profile including completed courses, current courses, grades, interests, and schedule preferences.",
  inputSchema: z.object({ studentId: z.string() }),
  callback: async ({ studentId }) => {
    const profile = await getStudentProfile(studentId);
    if (!profile) return "No profile found. Student needs to complete onboarding.";
    return JSON.stringify(profile, null, 2);
  },
});

export const updateProfile = tool({
  name: "update_student_profile",
  description: "Update a specific field in the student's profile. Use for updating interests, career goal, schedule preferences, commuting info, or extracurricular activities.",
  inputSchema: z.object({
    studentId: z.string(),
    field: z.string().describe("Dot-notation field to update, e.g. 'intereses', 'metaProfesional', 'horarioPreferencias.turno'"),
    value: z.any().describe("New value for the field"),
  }),
  callback: async ({ studentId, field, value }) => {
    const profile = await getStudentProfile(studentId) ?? { studentId };
    // Set nested field via dot notation
    const keys = field.split(".");
    let obj = profile;
    for (let i = 0; i < keys.length - 1; i++) {
      obj[keys[i]] = obj[keys[i]] ?? {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    await saveStudentProfile(profile);
    return `Updated ${field} successfully.`;
  },
});

export const saveProfessorMemory = tool({
  name: "save_professor_memory",
  description: "Save a personal note about a professor that the student wants to remember (e.g. 'a friend told me they give a lot of homework'). This is stored separately from official reviews.",
  inputSchema: z.object({
    studentId: z.string(),
    professorId: z.string(),
    nota: z.string().describe("Personal note about this professor"),
  }),
  callback: async ({ studentId, professorId, nota }) => {
    const profile = await getStudentProfile(studentId) ?? { studentId };
    profile.profesoresMemoria = profile.profesoresMemoria ?? {};
    profile.profesoresMemoria[professorId] = nota;
    await saveStudentProfile(profile);
    return `Saved personal note for professor ${professorId}.`;
  },
});

export const updateAcademicProgress = tool({
  name: "update_academic_progress",
  description: "Update a course in the student's academic history. Use when student reports they passed, failed, or are currently taking a course.",
  inputSchema: z.object({
    studentId: z.string(),
    clave: z.string().describe("Course key, e.g. '1310'"),
    estado: z.enum(["aprobada", "reprobada", "en_curso", "recursando"]),
    calificacion: z.number().optional().describe("Final grade (for aprobada/reprobada)"),
    semestre: z.string().optional().describe("Semester when taken, e.g. '2025-2'"),
  }),
  callback: async ({ studentId, clave, estado, calificacion, semestre }) => {
    const year = new Date().getFullYear();
    const period = new Date().getMonth() < 6 ? "1" : "2";
    await ddb.send(new PutCommand({
      TableName: process.env.PROGRESS_TABLE,
      Item: {
        studentId,
        clave,
        estado,
        calificacion,
        semestre: semestre ?? `${year}-${period}`,
        updatedAt: new Date().toISOString(),
      },
    }));
    return `Updated ${clave} to ${estado}${calificacion ? ` with grade ${calificacion}` : ""}.`;
  },
});

export const updateCourseGrades = tool({
  name: "update_course_grades",
  description: "Update partial grades for a course the student is currently taking.",
  inputSchema: z.object({
    studentId: z.string(),
    clave: z.string(),
    calificaciones: z.object({
      parcial1: z.number().optional(),
      parcial2: z.number().optional(),
      tareas: z.number().optional(),
      laboratorio: z.number().optional(),
    }),
  }),
  callback: async ({ studentId, clave, calificaciones }) => {
    await ddb.send(new PutCommand({
      TableName: process.env.PROGRESS_TABLE,
      Item: {
        studentId,
        clave,
        estado: "en_curso",
        calificaciones,
        updatedAt: new Date().toISOString(),
      },
    }));
    return `Updated grades for ${clave}.`;
  },
});
