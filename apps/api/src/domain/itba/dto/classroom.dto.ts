export interface ClassroomDto {
    name: string;
    building: string;
    day?: string | null;
    hourFrom?: string | null;
    hourTo?: string | null;
}

export interface ClassroomScheduleDto {
    classroom: string;
    building: string;
    day: string | null;
    hourFrom: string | null;
    hourTo: string | null;
}

export interface ClassroomsByBuildingDto {
    [building: string]: ClassroomDto[];
}

export interface ClassroomsByDayAndBuildingDto {
    [day: string]: {
        [building: string]: ClassroomScheduleDto[];
    };
}

// Legacy interfaces for backward compatibility
export interface ClassroomData {
    class_room: string;
    building: string;
    day: string | null;
    hour_from: string | null;
    hour_to: string | null;
}

export type ClassroomResponse = ClassroomData[];
export type ClassroomOutput = Record<string, Map<string, ClassroomData[]>>;
