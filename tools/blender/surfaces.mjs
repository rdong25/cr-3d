// Per-character hints for the Blender bake: which "smart material" each sculpted piece gets.
// Keys are regular expressions matched against the whole piece name; the first match wins.
// Pieces not listed fall back on their material key: metal -> steel (or gold when painted
// warm), team -> cloth, soft -> leather.
//
// Kinds: steel, gold, leather, cloth, mail, bone, painted, skin, wood

/** Every character that goes through the bake, by its tools/<name>/ folder. */
export const CHARACTERS = ['hero', 'minions', 'skeletons', 'prince', 'bomber', 'musketeer', 'archers', 'dragon', 'giant']

/** tools/<name>/ -> public/models/<file>.glb, where the two differ. */
export const GLB_NAME = { hero: 'ember-warden' }

/** Shipped texture edge in pixels (default 1024). */
export const TEXTURE_SIZE = {}

export const SURFACES = {
  hero: {
    'undersuit|coif': 'mail',
    'horn_[LR]': 'bone',
    'shield_face': 'painted',
  },
  minions: {
    'body|head|hand_[LR]|foot_[LR]|tail|wing_[LR]': 'skin',
    'teeth|horn_[LR]': 'bone',
  },
  skeletons: {
    'skull|jaw|teeth|vertebra_.*|ribs_[LR]|sternum|clavicle_[LR]|scapula_[LR]|pelvis|humerus_[LR]|forearm_[LR]|carpals_[LR]|hand_[LR]|femur_[LR]|patella_[LR]|shin_[LR]|foot_[LR]': 'bone',
    'arrow': 'wood',
    'shield_face': 'painted',
    // Rusted iron is painted warm; keep it steel, not gold.
    'helmet.*|pauldron.*|shield_iron|sword_guard|sword_blade|baldric_studs|pouch_stud|belt_buckle': 'steel',
  },
  prince: {
    'undersuit|coif': 'mail',
    'lance_shaft': 'bone',
    'mantle': 'cloth',
    'shield_face': 'painted',
  },
  bomber: {
    'skull|jaw|teeth': 'bone',
    'body|sleeve_[LR]|arm_wrap_[LR]|shin_wrap_[LR]|thigh_patch_[LR]|cloak_.*|hood|fuse_coil.*|bomb_fuse|belt_bomb_fuses': 'cloth',
    'bomb|belt_bombs': 'steel',
  },
  musketeer: {
    'face|eye_[LR]': 'skin',
    'breeches|coat|sleeve_[LR]|collar|shoulder_wing|scarf_.*|hat_brim|hat_crown|hair|hair_queue|charge_cords|flask_cord': 'cloth',
    'musket_stock|charges': 'wood',
    'musket_flint': 'bone',
  },
  archers: {
    'face|eye_[LR]|fingers_[LR]': 'skin',
    'undersuit|cowl|hood|mask|fringe|braid|braid_tuft|quiver_fletch_.*|arrow_fletch|bow_string': 'cloth',
    'bow_limb_.*|bow_riser|arrow_shaft|quiver_shafts|dagger_grip': 'wood',
    'quiver_nocks': 'bone',
  },
  dragon: {
    'trunk|head|jaw|tongue|foreleg_[LR]|hindleg_[LR]|tail_spade|wing_membrane_[LR]|wing_bones_[LR]': 'skin',
    'belly_plates|dorsal_spines|teeth|horns_[LR]|nape_spike|.*claws.*|elbow_spur_[LR]': 'bone',
  },
  giant: {
    'torso|arm_[LR]|face': 'skin',
    'leg_[LR]|mantle': 'cloth',
    'horn_[LR]': 'bone',
    '.*brass.*|.*studs.*|.*rivets.*|shoulder_trim_[LR]|gauntlet_bands_[LR]|mantle_clasps|kneestud_[LR]': 'gold',
    'belt_iron|buckle|chains|shoulder_cap_[LR]|shoulder_spike_[LR]|armlet_[LR]|gauntlet_cuff_[LR]|gauntlet_spikes_[LR]|fist_[LR]|fist_plate_[LR]|kneecop_[LR]|greave_[LR]|boot_iron_[LR]|mantle_chain|helmet|horn_socket_[LR]': 'steel',
  },
}
