# tools/blender/data

## mh_head_male.npz

The Diver's head and neck (`build_diver.py`, `build_head`). It is the head
and neck of the MakeHuman base mesh (`makehuman/data/3dobjs/base.obj`), shaped
as a young adult male by MakeHuman's macro targets
(`makehuman/data/targets/macrodetails/{caucasian,african,asian}-male-young.target`,
weighted equally), cut below the neck and saved as:

- `verts`: float32 (n, 3), MakeHuman units (decimetres), y up, z forward
- `faces`: int32 (m, 4), quads indexing `verts`
- `eyes`: float32 (2, 3), the left and right eye joint centres

Source: https://github.com/makehumancommunity/makehuman (master), fetched
2026-11-01.

Licence: the MakeHuman base mesh and targets are released under CC0 1.0
Universal ("These assets have been released under CC0 1.0 Universal",
`LICENSE.md` section C; the base mesh and target headers: "This asset was
explicitly released as CC0 in september 2020"). No attribution is required;
this note records the source anyway.
