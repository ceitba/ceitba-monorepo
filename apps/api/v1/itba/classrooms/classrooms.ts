import express from "express";
import supabase from "../../config/supabase";
import { ClassroomResponse,ClassroomData,ClassroomOutput } from "./models";
import { json } from "stream/consumers";
const router = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     ClassroomDataReduced:
 *       type: object
 *       properties:
 *         class_room:
 *           type: string
 *         building:
 *           type: string
 *     ClassroomData:
 *       type: object
 *       properties:
 *         class_room:
 *           type: string
 *         building:
 *           type: string
 *         day:
 *           type: string
 *         hour_from:
 *           type: string
 *         hour_to:
 *           type: string
 *     ClassroomOutput:
 *       type: object
 *       additionalProperties:
 *         type: object
 *         additionalProperties:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ClassroomData'
 * /itba/classrooms/occupied:
 *   get:
 *     tags:
 *       - ITBA
 *     summary: Retrieve occupied classroom data
 *     description: >
 *       Retrieves a list of occupied classrooms.
 *       The optional "current_semester" query parameter determines whether to filter
 *       results only for the current semester. Otherwise, all classrooms in the database are returned.
 *       The results are grouped by weekday and building.
 *     parameters:
 *       - in: query
 *         name: current_semester
 *         required: false
 *         schema:
 *           type: boolean
 *         description: If set to true, only returns active classrooms for the current semester.
 *     responses:
 *       200:
 *         description: A map of days to maps of buildings to arrays of classroom data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassroomOutput'
 *       500:
 *         description: Internal server error
 */
router.get("/occupied", async (req, res) => {
    const { current_semester } = req.query;

    //Current semester toma segun la fecha de hoy, se podria cambiar para que tome la fecha del cuatrimestre mas cercano, ya que durante las vacaciones
    //se muestra la info de las clases de vacaciones nada mas.
    
    const { data, error } = await supabase.rpc('get_classrooms', { current_semester: current_semester ?? true });
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    const classroomsMap = (data as ClassroomResponse).reduce((acc, classroom) => {
        const day = classroom.day!;
        const building = classroom.building;
        // Exclude online classrooms
        if (building == "Online"){
            return acc;
        }
        if (!acc[day]) {
            acc[day] = new Map<string, ClassroomData[]>();
        }
        if (!acc[day].get(building)) {
            acc[day].set(building, new Array<ClassroomData>());
        }
        acc[day].get(building)!.push(classroom);
        
        
        return acc;
    }, {} as ClassroomOutput);  
    
    
    // Magia negra de gpt para que se pueda parsear a JSON
    const plainObject = Object.fromEntries(
        Object.entries(classroomsMap).map(([day, buildingsMap]) => [day, Object.fromEntries(buildingsMap)])
    );

    
    
    res.status(200).json(plainObject);
});

/**
 * @openapi
 * /itba/classrooms/all:
 *   get:
 *     tags:
 *       - ITBA
 *     summary: Retrieve all classroom data
 *     description: >
 *       Retrieves a list of all classrooms in the database.
 *       The results are grouped by building.
 *     responses:
 *       200:
 *         description: A map of buildings to arrays of classroom data.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/ClassroomDataReduced'
 *       500:
 *         description: Internal server error
 */
router.get("/all", async (req, res) => {
    const { data, error } = await supabase.rpc("get_all_classrooms");
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    const classroomsMap = (data as ClassroomResponse).reduce((acc, classroom) => {
        const building = classroom.building;
        if (building == "Online"){
            return acc;
        }
        if (!acc[building]) {
            acc[building] = new Array<ClassroomData>();
        }
        acc[building].push(classroom);
        return acc;
    }, {} as Record<string, ClassroomData[]>);
    res.status(200).json(classroomsMap);
});

export default router;