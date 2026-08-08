import { tool } from "@strands-agents/sdk";
import { z } from "zod";
import {
  loadStudentProfile, saveStudentProfile,
  loadStudentProgress, saveStudentProgress,
} from "../session.mjs";

export const getProfile = tool({
  name: "get_student_profile",
  description: "Get the current student's full academic profile including completed courses, current courses, grades, interests, and schedule preferences.",
  inputSchema: z.object({ studentId: z.string() }),
  callback: async ({ studentId }) => {
    const profile = await loadStudentProfile(studentId);
    if (!profile) return "No hay perfil para este estudiante. Dile que se registre.";
    return JSON.stringify(profile, null, 2);
  },
});

export const updateProfile = tool({
  name: "update_student_profile",
  description: "Update a specific field in the student's profile. Use for updating interests, career goal, schedule preferences, commuting info, or extracurricular activities.",
  inputSchema: z.object({
    studentId: z.string(),
    field: z.string().describe("Dot-notation field, e.g. 'intereses', 'metaProfesional'"),
    value: z.any(),
  }),
  callback: async ({ studentId, field, value }) => {
    const profile = await loadStudentProfile(studentId) ?? { studentId };
    const keys = field.split(".");
    let obj = profile;
    for (let i = 0; i < keys.length - 1; i++) {
      obj[keys[i]] = obj[keys[i]] ?? {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    await saveStudentProfile(profile);
    return `Campo '${field}' actualizado.`;
  },
});

export const saveProfessorMemory = tool({
  name: "save_professor_memory",
  description: "Save a personal note about a professor that the student wants to remember.",
  inputSchema: z.object({
    studentId: z.string(),
    professorId: z.string(),
    nota: z.string(),
  }),
  callback: async ({ studentId, professorId, nota }) => {
    const profile = await loadStudentProfile(studentId) ?? { studentId };
    profile.profesoresMemoria = profile.profesoresMemoria ?? {};
    profile.profesoresMemoria[professorId] = nota;
    await saveStudentProfile(profile);
    return `Nota guardada para profesor ${professorId}.`;
  },
});

export const updateAcademicProgress = tool({
  name: "update_academic_progress",
  description: "Update a course in the student's academic history — passed, failed, or currently taking.",
  inputSchema: z.object({
    studentId: z.string(),
    clave: z.string(),
    estado: z.enum(["aprobada", "reprobada", "en_curso", "recursando"]),
    calificacion: z.number().optional(),
    semestre: z.string().optional(),
  }),
  callback: async ({ studentId, clave, estado, calificacion, semestre }) => {
    const courses = await loadStudentProgress(studentId);
    const year = new Date().getFullYear();
    const period = new Date().getMonth() < 6 ? "1" : "2";
    courses[clave] = {
      clave, estado,
      ...(calificacion !== undefined ? { calificacion } : {}),
      semestre: semestre ?? `${year}-${period}`,
      updatedAt: new Date().toISOString(),
    };
    await saveStudentProgress(studentId, courses);
    return `${clave} actualizada a ${estado}${calificacion ? ` (calificación ${calificacion})` : ""}.`;
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
    const courses = await loadStudentProgress(studentId);
    courses[clave] = {
      ...courses[clave],
      clave,
      estado: "en_curso",
      calificaciones,
      updatedAt: new Date().toISOString(),
    };
    await saveStudentProgress(studentId, courses);
    return `Calificaciones de ${clave} actualizadas.`;
  },
});
