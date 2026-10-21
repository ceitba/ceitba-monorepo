// web/kb/admin/KbAdminExceptionHandler: on the four web.kb.admin controllers a query or
// path parameter of the wrong type (a bad UUID, a non-numeric limit, "maybe" for a boolean)
// is 400 ValidationError "<name>: invalid <SimpleType> '<value>'", never Spring's
// conversion message. Missing required parameters keep Spring's default 400 BadRequest.

import { ArgumentTypeMismatchError, ConstraintViolationError } from '../../http/errors';
import { param, type ParamSpec } from '../../http/validation';

function admin<T>(spec: ParamSpec<T>, simpleName: string): ParamSpec<T> {
  return {
    javaType: spec.javaType,
    parse(raw, name) {
      try {
        return spec.parse(raw, name);
      } catch (e) {
        if (e instanceof ArgumentTypeMismatchError) throw new ConstraintViolationError(`${name}: invalid ${simpleName} '${raw}'`);
        throw e;
      }
    },
  };
}

export const ap = {
  uuid: (o: { required?: boolean } = {}) => admin(param.uuid(o), 'UUID'),
  int: (def: number) => admin(param.int({ def, primitive: true }), 'int'),
  bool: (def: boolean) => admin(param.bool({ def }), 'boolean'),
  string: (o: { required?: boolean; def?: string } = {}) => param.string(o),
};
